---
name: refill-caregiver
description: Use the Refill MCP add-on to keep an aging parent's home stocked for a long-distance family caregiver. Covers checking what is running low, drafting one consolidated order for the caregiver to confirm, routing prescription refills to the pharmacy, handing medication questions to a pharmacist, and sending the weekly family digest. Use when the user asks about a parent's supplies, groceries, incontinence supplies, prescriptions, refills, or updating family members.
license: TBD
compatibility: Requires the Refill MCP server (MCP 2025-11-25, Streamable HTTP) with an OAuth-linked account. Clients that render MCP Apps (ui:// resources) show interactive cards; others get text and structured output.
metadata:
  server-url: https://<deployment>/api/mcp
  resource-metadata: /.well-known/oauth-protected-resource
---

# Refill for caregivers

Refill tracks supplies and prescriptions at the parent's home and predicts run-out dates from daily use. It never buys or requests anything without the caregiver's explicit confirmation.

## Tools and when to call them

| User intent | Tool | Notes |
| --- | --- | --- |
| "What's running low?", "What does Dad need?" | `get_supply_status` | Read-only. Renders `ui://refill/running-low`. |
| "Order what he needs", "Restock" | `draft_refill_order` | Builds one order for non-prescription items that run out within 7 days, sized for 14 days. Nothing is purchased. Renders `ui://refill/checkout`. |
| Caregiver confirms the order (e.g. taps **Place order**, which sends "Confirm order ORD-002 for $99.94") | `place_order` | Only with a confirmed draft id. The server enforces the monthly budget cap and duplicate prevention. |
| Caregiver explicitly approves a prescription refill ("Yes, request the Lisinopril refill") | `request_prescription_refill` | Pass `rxId` only. Quantity is fixed by the prescription; sending `quantity` is rejected. This is a request to the pharmacy, not a purchase. |
| Any question about doses, extra or missed pills, side effects, interactions, stopping a medicine | `ask_pharmacist` | Do not answer it yourself. Forward the question; a licensed pharmacist calls back. |
| "Someone dropped off supplies" | `update_supply` | Positive units to add, negative to remove. |
| "Update the family", "weekly digest" | `send_family_digest` | Renders `ui://refill/digest`. |

`simulate_days` is a demo control and should not be used by assistants.

## Conversation style

Replies are spoken on a smart display: one or two warm sentences. Let the card carry the details (items, prices, ids). Mention totals and which medicine is due, then ask the caregiver to confirm on the card.

## Guardrails to respect

1. No purchase without the caregiver confirming that specific draft order.
2. Prescription refills need an explicit yes naming the medicine, after it was shown to the caregiver; never change quantities.
3. Stay within the monthly budget; don't re-order items already on an open order.
4. No medical or dosing advice, ever: route to `ask_pharmacist`. In an emergency, tell the caregiver to call 911.

If a tool returns `Blocked by rule …`, follow the reason and explain it in one sentence.
