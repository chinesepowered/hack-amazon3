// The Strands agent behind the simulated Alexa+ display. It reaches Refill only through its MCP server
// (Strands McpClient over Streamable HTTP). Deterministic code decides what must happen:
// intent routing names the tool a request requires, Strands hooks gate every sensitive call,
// and a steering pass re-prompts the agent if it still skipped the required tool.
import { Agent, BeforeModelCallEvent, BeforeToolCallEvent, McpClient } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LOW_DAYS, type Household } from "./domain";
import { peekState } from "./sign";

export type Verdict = "allowed" | "blocked" | "routed" | "steered";

export type AgentEvent =
  | { type: "mcp"; phase: "request"; id: string | number; method: string; tool?: string; args?: unknown }
  | { type: "mcp"; phase: "response"; id: string | number; method: string; tool?: string; status: number; ms: number; isError?: boolean; text?: string; summary?: string; structuredContent?: unknown; resourceUri?: string }
  | { type: "hook"; rule: string; tool: string; verdict: Verdict; reason: string }
  | { type: "say"; text: string }
  | { type: "state"; token: string }
  | { type: "error"; message: string };

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface RunInput {
  text: string;
  history: ChatTurn[];
  accessToken: string;
  stateToken: string | null;
  mcpUrl: string;
  emit: (e: AgentEvent) => void;
}

const MEDICAL = /\b(doses?|dosage|dosing|mg|milligrams?|extra (pill|tablet|dose|lisinopril|metformin)s?|double (up|dose)|skip(ped)? (a |his |her )?(dose|pill)|take (an? )?(more|another|extra)|stop taking|side effects?|interact(ion|ions)?|overdose|missed (a |his |her )?(dose|pill))\b/i;
const CONFIRM = /\b(yes|confirm(ed)?|go ahead|approve[d]?|okay|ok|place it|do it|request)\b/i;
const MAX_MODEL_CALLS = 8;

type Intent = { tool: string; hint: string; why: string } | null;

/** Deterministic intent routing: which Refill tool this request can't be answered without. */
export function requiredTool(text: string, h: Household | null): Intent {
  const t = text.toLowerCase();
  if (MEDICAL.test(text)) return { tool: "ask_pharmacist", hint: `with her question`, why: "medication question" };
  const orderId = /\bORD-\d{3}\b/i.exec(text)?.[0]?.toUpperCase();
  if (orderId || (CONFIRM.test(text) && /\b(order|place)\b/.test(t) && !/\brefill\b/.test(t))) {
    const id = orderId ?? h?.orders.filter((o) => o.status === "draft").at(-1)?.id;
    if (id) return { tool: "place_order", hint: `with orderId "${id}"`, why: "caregiver confirmed an order" };
  }
  const rx = h?.rx.find((r) => t.includes(r.id.toLowerCase()) || t.includes(r.drug.toLowerCase()));
  if (rx && CONFIRM.test(text) && /\brefill\b/.test(t) && !/\border what\b/.test(t)) return { tool: "request_prescription_refill", hint: `with rxId "${rx.id}" and no quantity`, why: "caregiver approved a refill" };
  if (/\b(family|digest|weekly update|this week'?s update)\b/.test(t)) return { tool: "send_family_digest", hint: "", why: "family update" };
  if (/\b(order|restock|buy|stock up|what he needs|what she needs|get (him|her) what)\b/.test(t)) return { tool: "draft_refill_order", hint: "", why: "restock request" };
  if (/\b(low|running out|run out|status|supplies|how much|left at|what does (he|she) need)\b/.test(t)) return { tool: "get_supply_status", hint: "", why: "supply question" };
  return null;
}

const SYSTEM_PROMPT = `You are Refill, an add-on running on an Alexa+ smart display. You help Maya, who lives in Seattle, keep her 81-year-old father Walter's home in Tucson stocked with supplies and prescriptions.
Your replies are spoken aloud: one or two short, warm sentences, at most 30 words. No lists, no markdown, never read out order or prescription ids, round money naturally ("about a hundred dollars"). The card on screen shows the details.
You can only find things out or change anything by calling Refill's tools. Only describe an action as done if a tool result in THIS request says it succeeded. If a guardrail blocked a tool, say plainly that it has NOT happened yet and what Maya needs to do.
Messages may end with a [Refill routing] note naming the tool the request needs; call that tool.
How to act:
- "What's low / running out / what does he need" -> get_supply_status.
- "Order / restock / get what he needs" -> draft_refill_order, then tell her the total and ask her to confirm on the card. Only call place_order when her latest message confirms that order.
- Prescriptions due: say which medicine is due and that she can approve the refill request on the card. Call request_prescription_refill only after she explicitly says yes to that medicine. Pass rxId only, never a quantity.
- Any question about doses, extra or missed pills, side effects, interactions, or stopping a medicine: do not answer it. Call ask_pharmacist with her question, then say a pharmacist will call her back.
- "Update the family / weekly digest" -> send_family_digest.
- Call each tool at most once per request unless a guardrail tells you otherwise.`;

function explicitlyConfirms(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return CONFIRM.test(text) && needles.some((n) => t.includes(n.toLowerCase()));
}

export async function runRefillAgent(input: RunInput): Promise<void> {
  const { emit, text } = input;
  const state = { token: input.stateToken };
  const startHousehold: Household | null = peekState(state.token);
  const draftsAtStart = new Set((startHousehold?.orders ?? []).filter((o) => o.status === "draft").map((o) => o.id));
  const rxShownAtStart = Boolean(startHousehold && startHousehold.orders.length > 0);
  const medical = MEDICAL.test(text);
  const intent = requiredTool(text, startHousehold);
  const toolUi = new Map<string, string>();
  const executed = new Set<string>();
  const blocked = new Set<string>();

  const capturingFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${input.accessToken}`);
    if (state.token) headers.set("x-refill-state", state.token);
    let msg: { id?: string | number; method?: string; params?: { name?: string; arguments?: unknown } } | undefined;
    try {
      msg = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    } catch {
      msg = undefined;
    }
    const t0 = Date.now();
    if (msg?.method && msg.id !== undefined && msg.method !== "ping") {
      emit({ type: "mcp", phase: "request", id: msg.id, method: msg.method, tool: msg.params?.name, args: msg.params?.arguments });
    }
    const res = await fetch(url, { ...init, headers });
    const next = res.headers.get("x-refill-state");
    if (next) state.token = next;
    if (msg?.method && msg.id !== undefined && msg.method !== "ping" && (res.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await res.clone().json().catch(() => null);
      const result = body?.result;
      let summary: string | undefined;
      if (msg.method === "initialize") summary = `negotiated MCP ${result?.protocolVersion} · ${result?.serverInfo?.name}`;
      if (msg.method === "tools/list") {
        for (const t of result?.tools ?? []) {
          const uri = t?._meta?.ui?.resourceUri ?? t?._meta?.["ui/resourceUri"];
          if (uri) toolUi.set(t.name, uri);
        }
        summary = `${result?.tools?.length ?? 0} tools · ${toolUi.size} with MCP Apps UI`;
      }
      if (msg.method === "tools/call" && msg.params?.name && result && !result.isError) executed.add(msg.params.name);
      emit({
        type: "mcp",
        phase: "response",
        id: msg.id,
        method: msg.method,
        tool: msg.params?.name,
        status: res.status,
        ms: Date.now() - t0,
        isError: result?.isError,
        text: msg.method === "tools/call" ? result?.content?.[0]?.text : undefined,
        summary: summary ?? (body?.error ? `error ${body.error.code}: ${body.error.message}` : undefined),
        structuredContent: msg.method === "tools/call" ? result?.structuredContent : undefined,
        resourceUri: msg.method === "tools/call" ? toolUi.get(msg.params?.name ?? "") : undefined,
      });
    }
    return res;
  };

  const mcp = new McpClient({
    applicationName: "Refill Alexa+ display simulator",
    transport: new StreamableHTTPClientTransport(new URL(input.mcpUrl), { fetch: capturingFetch }),
    // A medication question only ever sees the pharmacist tool; the demo clock is never exposed to the model.
    toolFilters: medical ? { allowed: ["ask_pharmacist"] } : { rejected: ["simulate_days"] },
  });

  const model = new OpenAIModel({
    api: "chat",
    apiKey: process.env.OPENAI_API_KEY,
    modelId: process.env.OPENAI_MODEL,
    clientConfig: { baseURL: process.env.OPENAI_BASE_URL },
    params: { temperature: 0, chat_template_kwargs: { enable_thinking: false } },
  } as ConstructorParameters<typeof OpenAIModel>[0]);

  const agent = new Agent({
    model,
    tools: [mcp],
    systemPrompt: SYSTEM_PROMPT,
    printer: false,
    messages: input.history.slice(-4).map((m) => ({ role: m.role, content: [{ text: m.text }] })),
  } as ConstructorParameters<typeof Agent>[0]);

  const block = (e: BeforeToolCallEvent, rule: string, reason: string) => {
    e.cancel = `Guardrail ${rule} blocked ${e.toolUse.name}. It has NOT happened. ${reason}`;
    blocked.add(e.toolUse.name);
    emit({ type: "hook", rule, tool: e.toolUse.name, verdict: "blocked", reason });
  };
  const allow = (e: BeforeToolCallEvent, rule: string, reason: string) => emit({ type: "hook", rule, tool: e.toolUse.name, verdict: "allowed", reason });

  agent.addHook(BeforeToolCallEvent, (e) => {
    const name = e.toolUse.name;
    const args = (e.toolUse.input ?? {}) as Record<string, unknown>;
    const h = peekState(state.token);

    if (medical && name !== "ask_pharmacist") {
      return block(e, "no-medical-advice", "This is a medication question. Only ask_pharmacist is allowed; don't advise.");
    }
    if (name === "ask_pharmacist" && medical) return allow(e, "no-medical-advice", "Medication question goes to a licensed pharmacist; Refill gives no dosing advice.");

    if (name === "place_order") {
      const orderId = String(args.orderId ?? "");
      const order = h?.orders.find((o) => o.id === orderId);
      if (!order || !draftsAtStart.has(orderId)) {
        return block(e, "caregiver-confirms-purchase", "Maya hasn't seen this order yet. Show the checkout card and wait for her to confirm.");
      }
      if (!text.toUpperCase().includes(orderId) && !explicitlyConfirms(text, ["order", "place"])) {
        return block(e, "caregiver-confirms-purchase", `Maya hasn't confirmed ${orderId}. Ask her to confirm on the card.`);
      }
      if (order.status !== "draft" || order.lines.some((l) => h!.orders.some((o) => o.status === "placed" && o.lines.some((x) => x.itemId === l.itemId)))) {
        return block(e, "no-duplicate-orders", "Some of these items are already on an open order.");
      }
      const remaining = h!.budget.monthly - h!.budget.spent;
      if (order.total > remaining) {
        return block(e, "monthly-budget-cap", `$${order.total.toFixed(2)} is over the $${remaining.toFixed(2)} left this month.`);
      }
      return allow(e, "caregiver-confirms-purchase", `Maya confirmed ${orderId} ($${order.total.toFixed(2)}); within budget; no duplicates.`);
    }

    if (name === "request_prescription_refill") {
      if (args.quantity !== undefined && args.quantity !== null) {
        return block(e, "rx-quantity-locked", "Quantity comes from the prescription. Call again with rxId only.");
      }
      const rx = h?.rx.find((r) => r.id === args.rxId || r.drug.toLowerCase() === String(args.rxId ?? "").toLowerCase());
      if (!rx) return block(e, "rx-on-file", "That prescription isn't on file.");
      if (!rxShownAtStart || !explicitlyConfirms(text, [rx.id, rx.drug])) {
        return block(e, "rx-needs-explicit-ok", `The ${rx.drug} refill is waiting on the card for Maya's explicit approval.`);
      }
      return allow(e, "rx-needs-explicit-ok", `Maya explicitly approved ${rx.drug}; quantity locked to ${rx.qtyPerFill} tablets as prescribed.`);
    }

    if (name === "draft_refill_order" && h) {
      const low = h.items.filter((i) => i.category !== "rx" && Math.floor(i.onHand / i.dailyUse) <= LOW_DAYS);
      const covered = low.filter((i) => h.orders.some((o) => o.status === "placed" && o.lines.some((l) => l.itemId === i.id)));
      if (covered.length) allow(e, "no-duplicate-orders", `Leaving off ${covered.map((i) => i.name).join(", ")}: already on order.`);
    }
  });

  let modelCalls = 0;
  agent.addHook(BeforeModelCallEvent, (e) => {
    modelCalls += 1;
    if (modelCalls > MAX_MODEL_CALLS) e.cancel = "Step limit reached.";
  });

  const clean = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\[Refill (routing|steering)[^\]]*\]/g, "").trim();

  try {
    let prompt = text;
    if (intent) {
      emit({ type: "hook", rule: "intent-routing", tool: intent.tool, verdict: "routed", reason: `${intent.why} → requires ${intent.tool}` });
      prompt = `${text}\n\n[Refill routing: this request requires ${intent.tool}${intent.hint ? ` ${intent.hint}` : ""}.]`;
    }
    let reply = clean(String(await agent.invoke(prompt)));
    if (intent && !executed.has(intent.tool) && !blocked.has(intent.tool)) {
      // Steering: the request can't be answered without this tool, so re-prompt once instead of trusting the text.
      emit({ type: "hook", rule: "required-tool", tool: intent.tool, verdict: "steered", reason: "Reply skipped the required tool; steering the agent to call it before answering." });
      modelCalls = 0;
      reply = clean(String(await agent.invoke(`[Refill steering] You have not called ${intent.tool} in this request. Call ${intent.tool} now ${intent.hint}. Then answer Maya's message in one or two sentences using only that tool's result.`)));
    }
    if (medical && !executed.has("ask_pharmacist")) {
      reply = `I can't give advice about doses or medicines. Please call ${startHousehold?.pharmacy ?? "the pharmacy"} or Walter's doctor, and for an emergency call 911.`;
    }
    emit({ type: "say", text: reply || "Done." });
  } catch (err) {
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    await mcp.disconnect().catch(() => undefined);
    if (state.token) emit({ type: "state", token: state.token });
  }
}
