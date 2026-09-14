// Refill MCP server: tools + MCP Apps resources. Built fresh per HTTP request (stateless Streamable HTTP);
// the household is loaded from the signed state blob and written back after the request.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import * as D from "../domain";
import { APPS } from "./ui";

export interface ServerCtx {
  h: D.Household;
}

type Result = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
type ResourceConfig = Parameters<typeof registerAppResource>[3];

const ok = (text: string, structuredContent: object): Result => ({ content: [{ type: "text", text }], structuredContent: structuredContent as Record<string, unknown> });
const fail = (e: unknown): Result => ({ isError: true, content: [{ type: "text", text: e instanceof D.RuleError ? `Blocked by rule ${e.rule}: ${e.message}` : `Error: ${String(e)}` }] });

function guard(fn: () => Result): Result {
  try {
    return fn();
  } catch (e) {
    return fail(e);
  }
}

export function buildServer(ctx: ServerCtx): McpServer {
  const server = new McpServer(
    { name: "refill", title: "Refill", version: "1.0.0" },
    {
      instructions:
        "Refill keeps an aging parent's home stocked for a family caregiver who lives far away. Use get_supply_status for what's running low, draft_refill_order before any purchase, and let the caregiver confirm on the checkout card. Prescription refills are requests to the pharmacy, never purchases, and need the caregiver's explicit OK. Never give dosing or medical advice; use ask_pharmacist.",
    },
  );

  for (const app of APPS) {
    const config = { description: app.description, mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: false } } } as unknown as ResourceConfig;
    registerAppResource(server, app.title, app.uri, config, async () => ({
      contents: [{ uri: app.uri, mimeType: RESOURCE_MIME_TYPE, text: app.html }],
    }));
  }

  registerAppTool(
    server,
    "get_supply_status",
    {
      title: "What's running low",
      description: "Predicts, from daily use, how many days each household supply and prescription has left at the parent's home. Includes what is already on order or being refilled.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: "ui://refill/running-low" } },
    },
    async () =>
      guard(() => {
        const r = D.statusReport(ctx.h);
        const urgent = r.items.filter((i) => i.status !== "ok").map((i) => `${i.name}: ${i.daysLeft} days${i.onOrder ? " (on order)" : i.rx?.request ? " (refill requested)" : ""}`);
        return ok(`As of ${r.todayLabel} at ${r.household}: ${urgent.length ? urgent.join("; ") : "nothing is running low"}. Budget left: $${r.budget.remaining.toFixed(2)}.`, r);
      }),
  );

  registerAppTool(
    server,
    "draft_refill_order",
    {
      title: "Draft a refill order",
      description: "Builds ONE consolidated order for every non-prescription item that runs out within 7 days, sized to cover the next coverDays. Skips items already on an open order. Lists prescriptions that are due so the caregiver can approve a refill request. Does not purchase anything.",
      inputSchema: {
        coverDays: z.number().int().min(7).max(30).optional().describe("Days of supply to buy for. Default 14."),
        excludeItemIds: z.array(z.string()).optional().describe("Item ids the caregiver asked to leave off."),
      },
      _meta: { ui: { resourceUri: "ui://refill/checkout" } },
    },
    async ({ coverDays, excludeItemIds }: { coverDays?: number; excludeItemIds?: string[] }) =>
      guard(() => {
        const v = D.draftOrder(ctx.h, coverDays ?? D.DEFAULT_COVER_DAYS, excludeItemIds ?? []);
        const rx = v.rxDue.map((r) => `${r.drug} ${r.strength} (${r.rxId})`).join(", ");
        const text = v.order
          ? `Drafted ${v.order.id}: ${v.order.lines.length} items, $${v.order.total.toFixed(2)} (${v.budget.withinBudget ? "within" : "OVER"} budget). The caregiver must confirm on the card before place_order.${rx ? ` Prescription due, needs caregiver OK: ${rx}.` : ""}`
          : `Nothing needs ordering.${rx ? ` Prescription due, needs caregiver OK: ${rx}.` : ""}`;
        return ok(text, v);
      }),
  );

  registerAppTool(
    server,
    "place_order",
    {
      title: "Place the confirmed order",
      description: "Places a drafted order after the caregiver has confirmed it. Enforces the monthly budget cap and duplicate-order prevention.",
      inputSchema: { orderId: z.string().describe("Draft order id, e.g. ORD-002") },
      _meta: { ui: { resourceUri: "ui://refill/checkout" } },
    },
    async ({ orderId }: { orderId: string }) =>
      guard(() => {
        const v = D.placeOrder(ctx.h, orderId);
        return ok(`Placed ${orderId} for $${v.order!.total.toFixed(2)}; arrives ${v.order!.etaLabel}. $${v.budget.remaining.toFixed(2)} left this month.`, v);
      }),
  );

  registerAppTool(
    server,
    "request_prescription_refill",
    {
      title: "Request a prescription refill",
      description: "Sends a refill REQUEST to the parent's pharmacy for a prescription on file. Not a purchase. Quantity always comes from the prescription; leave quantity empty.",
      inputSchema: {
        rxId: z.string().describe("Prescription id, e.g. RX-40218"),
        quantity: z.number().optional().describe("Leave empty. Quantity is fixed by the prescription."),
      },
      _meta: { ui: { resourceUri: "ui://refill/checkout" } },
    },
    async ({ rxId, quantity }: { rxId: string; quantity?: number }) =>
      guard(() => {
        if (quantity !== undefined) throw new D.RuleError("rx-quantity-locked", "Quantity is fixed by the prescription and can't be set by the assistant.");
        const v = D.requestRefill(ctx.h, rxId);
        const req = v.rxRequests.at(-1)!;
        return ok(`Refill request ${req.id} for ${req.drug} (${req.qty} tablets) sent to ${ctx.h.pharmacy}.`, v);
      }),
  );

  registerAppTool(
    server,
    "ask_pharmacist",
    {
      title: "Ask the pharmacist",
      description: "Forwards a medication, dosing, side-effect or interaction question to a licensed pharmacist, who calls the caregiver back. Use this instead of answering any such question.",
      inputSchema: { question: z.string().min(3).max(280).describe("The caregiver's question, in their words") },
      _meta: { ui: { resourceUri: "ui://refill/pharmacist" } },
    },
    async ({ question }: { question: string }) =>
      guard(() => {
        const v = D.askPharmacist(ctx.h, question);
        return ok(`Question ${v.ticket} sent to the pharmacist at ${v.pharmacy}; callback ${v.expectedCallback}.`, v);
      }),
  );

  server.registerTool(
    "update_supply",
    {
      title: "Record a restock",
      description: "Records supplies someone dropped off (positive units) or found missing (negative units).",
      inputSchema: {
        itemId: z.string().describe("Item id, e.g. gloves"),
        units: z.number().int().min(-500).max(500),
        who: z.string().max(40).optional().describe("Who dropped it off"),
      },
    },
    async ({ itemId, units, who }: { itemId: string; units: number; who?: string }) =>
      guard(() => {
        const v = D.updateSupply(ctx.h, itemId, units, who ?? ctx.h.caregiver.name);
        return ok(`${v.name}: now ${v.onHand} ${v.unit}, ${v.daysLeft} days left.`, v);
      }),
  );

  registerAppTool(
    server,
    "send_family_digest",
    {
      title: "Send the weekly family digest",
      description: "Builds this week's family update (deliveries, refills, pharmacist calls, budget, what runs out next) and sends it to the family circle.",
      inputSchema: {},
      _meta: { ui: { resourceUri: "ui://refill/digest" } },
    },
    async () =>
      guard(() => {
        const v = D.buildDigest(ctx.h);
        return ok(`Digest for ${v.weekLabel} sent to ${v.sentTo.map((f) => f.name).join(", ")}: ${v.highlights.length} updates, $${v.budget.spent.toFixed(2)} spent.`, v);
      }),
  );

  server.registerTool(
    "simulate_days",
    {
      title: "Demo control: advance time",
      description: "Demo only. Advances the simulated calendar so deliveries arrive and supplies get used. Not exposed to the assistant.",
      inputSchema: { days: z.number().int().min(1).max(7) },
    },
    async ({ days }: { days: number }) => guard(() => ok(`Advanced ${days} days.`, D.simulateDays(ctx.h, days))),
  );

  return server;
}
