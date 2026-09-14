// Streams one Strands agent turn to the display as NDJSON: MCP traffic, hook verdicts, spoken reply, new state.
import { runRefillAgent, type AgentEvent, type ChatTurn } from "@/lib/agent";
import { rateLimit } from "@/lib/ratelimit";
import { readBearer } from "@/lib/sign";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, agent: "Strands Agents SDK (TypeScript)", model: process.env.OPENAI_MODEL ?? null, configured: Boolean(process.env.OPENAI_API_KEY), mcp: "/api/mcp", spec: "2025-11-25" });
}

export async function POST(req: Request) {
  if (!rateLimit(req)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  const base = new URL(req.url).origin;
  const mcpUrl = `${base}/api/mcp`;
  const token = readBearer(req, mcpUrl);
  if (!token) return Response.json({ error: "Account not linked" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { text?: string; history?: ChatTurn[]; state?: string | null } | null;
  const text = (body?.text ?? "").trim().slice(0, 400);
  if (!text) return Response.json({ error: "Say something" }, { status: 400 });
  const history = (Array.isArray(body?.history) ? body!.history : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .map((m) => ({ role: m.role, text: m.text.slice(0, 600) }));
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runRefillAgent({ text, history, accessToken, stateToken: body?.state ?? null, mcpUrl, emit });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
