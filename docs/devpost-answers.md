# Devpost answers (draft)

## Name (≤60)
Refill: keep Dad's house stocked, from far away

## Tagline (≤200)
An Alexa+ add-on (MCP server + MCP Apps) that predicts what an aging parent will run out of, drafts one order the caregiver confirms, and routes refills to the pharmacy. Guarded by Strands Agents hooks.

## Track
Alexa+ · AWS Builder mini challenge: Yes · Open Source mini challenge: No

## Project status
New (built during the submission window).

## Built with
nextjs, react, typescript, model-context-protocol, mcp-apps, strands-agents, oauth2, pkce, zod, tailwindcss, vercel, web-speech-api, qwen, elevenlabs

## Links
- Live demo / testing link: https://refill-delta-six.vercel.app
- Code: https://github.com/chinesepowered/refill
- Slides: https://refill-delta-six.vercel.app/slides.html

## Description (markdown)

**63 million Americans are family caregivers** (AARP & National Alliance for Caregiving, *Caregiving in the US 2025*). When a parent lives in another city, much of that work is logistics: noticing the briefs are almost gone, remembering which prescription is due, not double-buying what a sibling already bought, and keeping everyone in the loop.

**Refill** is an Alexa+ add-on for that caregiver. Maya, in Seattle, talks to it about her dad Walter's home in Tucson:

- **"What's running low at Dad's?"** A timeline card (an MCP App) shows days left for every supply and prescription, predicted from daily use.
- **"Order what he needs, and refill his lisinopril."** Refill drafts one consolidated order, sized for two weeks, inside the monthly budget, skipping anything already on order. The due prescription appears as a separate approval.
- **She taps Place order, then Request refill.** Nothing is purchased without her confirmation, and refills are requests to the pharmacy with the quantity locked to the prescription.
- **"Can he take an extra pill?"** Refill never gives medical advice; the question goes to a pharmacist.
- **Three days later**, the order has arrived and her brother picked up the refill. Refill remembers the household and sends the family a weekly digest.

### How it's built
- **Alexa+ add-on:**
  - A self-hosted MCP server on spec **2025-11-25** over **Streamable HTTP** (`@modelcontextprotocol/sdk`), with 8 tools with structured output.
  - **4 MCP Apps** (`@modelcontextprotocol/ext-apps`, `ui://` resources): running-low timeline, checkout, pharmacist handoff, family digest. Checkout buttons confirm via `ui/message`.
  - **OAuth 2.1 + PKCE** account linking, with 401 + Protected Resource Metadata and Origin validation.
  - An **Agent Skill** (`skills/refill-caregiver/SKILL.md`).
- **Simulated Alexa+ display**, because real Alexa+ deployment is limited to select partners:
  - Push-to-talk voice, spoken replies and captions.
  - An MCP Apps host (`AppBridge` in a sandboxed iframe).
  - A live panel showing every MCP request and guardrail decision.
- **Strands Agents SDK (TypeScript):**
  - An `Agent` connected to Refill through `McpClient`, using `OpenAIModel` (Qwen3.8-27B).
  - `BeforeToolCallEvent` hooks enforce caregiver confirmation for purchases, explicit approval and a locked quantity for prescriptions, a budget cap, duplicate prevention, and no medical advice.
  - `BeforeModelCallEvent` caps steps.
  - Deterministic intent routing and steering make sure the required tool actually runs before the agent answers.
- **Memory across sessions:** an HMAC-signed household state blob, with no database needed for the demo.

All people, stores and the pharmacy are fictional, and payments are simulated. Built with Claude Code as a coding assistant.

## Testing instructions
No sign-up needed.
1. Open https://refill-delta-six.vercel.app and click **Link Refill account**, then **Allow** (demo OAuth + PKCE).
2. Type or say: "What's running low at Dad's?"
3. "Order what he needs, and refill his lisinopril." Then tap **Place order** and **Request refill** on the card.
4. "Can he take an extra lisinopril if his blood pressure is high?"
5. Click **⏩ 3 days later**, then say "Send the family this week's update."

The right panel shows every MCP call and every Strands hook verdict. **Reset demo** starts over. The MCP endpoint is `/api/mcp`, and `scripts/smoke-mcp.mjs` exercises the protocol end to end. Agent requests are rate limited per IP.

## AWS Builder mini challenge: which AWS services and how
**Strands Agents SDK (TypeScript, `@strands-agents/sdk`)** powers the assistant on the simulated Alexa+ display (`lib/agent.ts`):
- `Agent` with `McpClient` over Streamable HTTP, so the agent reaches Refill only through its MCP server.
- `OpenAIModel` pointed at an OpenAI-compatible endpoint (Qwen3.8-27B on W&B Inference). Strands' provider abstraction means Amazon Bedrock is a drop-in swap; we avoided paid services for the demo.
- `BeforeToolCallEvent` hooks as deterministic guardrails: caregiver confirmation for purchases, explicit OK and a locked quantity for prescriptions, monthly budget cap, duplicate prevention, and medication questions routed only to a pharmacist tool (also enforced through `McpClient` tool filters).
- `BeforeModelCallEvent` step cap, and a steering pass when a required tool was skipped.
- Hook verdicts and MCP traffic stream to the UI as NDJSON.

## Feedback Q1: Which developer tools, APIs, and SDKs did you use and for what?
- **Alexa+ MCP Toolkit docs** (quickstart, account linking): server requirements for transport, auth discovery and latency.
- **MCP TypeScript SDK** `@modelcontextprotocol/sdk` 1.30: the Streamable HTTP server (`WebStandardStreamableHTTPServerTransport`, stateless JSON mode), plus the client in the browser and in the agent.
- **MCP Apps SDK** `@modelcontextprotocol/ext-apps` 2.0: `registerAppTool` / `registerAppResource` on the server, and `AppBridge` + `PostMessageTransport` as the host in our simulated display.
- **Agent Skills spec** (agentskills.io): `skills/refill-caregiver/SKILL.md`.
- **Strands Agents TypeScript SDK** 1.17: `Agent`, `McpClient`, `OpenAIModel`, `BeforeToolCallEvent` / `BeforeModelCallEvent` hooks.
- **MCP spec 2025-11-25 authorization**: OAuth 2.1 + PKCE and Protected Resource Metadata (RFC 9728).
- Supporting tools: Next.js on Vercel, Web Speech API, Playwright (demo recording), ElevenLabs (narration).

## Feedback Q2: What worked well?
- **MCP TypeScript SDK:** `WebStandardStreamableHTTPServerTransport` dropped straight into a Next.js route handler. Stateless mode (`sessionIdGenerator: undefined`, `enableJsonResponse`) is perfect for serverless, and protocol negotiation to 2025-11-25 worked out of the box.
- **MCP Apps:** the `_meta.ui.resourceUri` + `ui://` model is simple, and `AppBridge` made hosting sandboxed cards in our own display straightforward. `ui/message` is a clean way for a card button to hand intent back to the conversation.
- **Strands TypeScript SDK:**
  - `McpClient` as a tool provider means zero glue code; tools come straight from `tools/list`.
  - `BeforeToolCallEvent` with `event.cancel = "reason"` is exactly the right primitive for deterministic guardrails, and the model sees the reason.
  - Tool filters (`allowed` / `rejected`) let us expose only the pharmacist tool for medication questions.
- **Alexa+ docs:** the account-linking page is concrete (exact token request parameters, PKCE S256 requirement, redirect URI guidance), which made the OAuth side quick.

## Feedback Q3: What needs work?
- **Alexa+ docs consistency:**
  - The MCP Toolkit quickstart says to return 401 *without* `WWW-Authenticate` and to host metadata at `/.well-known/oauth-authorization-server`.
  - The account-linking page says 401 *or* 403 and `/.well-known/oauth-protected-resource`.
  - The MCP spec requires `WWW-Authenticate` with `resource_metadata`.
  - We had to implement both documents and guess.
- **No non-partner sandbox for Alexa+.** Deployment is "select partners only", so we couldn't validate against the real Alexa+ client and had to build a simulator.
- **ext-apps typings:** `McpUiAppResourceConfig` rejects `description`, and `registerAppTool` callbacks lose argument inference with zod 4, so every handler needed manual types.
- **ext-apps standalone client:** there's no small inlineable App client for bundler-free `ui://` HTML; `app-with-deps.js` is ~418 KB. We hand-rolled the postMessage protocol, and found a sizing pitfall with `scrollHeight` that isn't documented.
- **Strands (with a non-Claude model):** when a hook cancels a tool, the model sometimes replies as if the action happened. A first-class "required tool" steering option, or an easy way to inspect executed vs. cancelled tool calls after `invoke`, would help a lot.
- **MCP client in the browser:** against a stateless JSON server the client still opens a GET stream and gets 405, which shows as a console error.

## Feedback Q4: How was your onboarding experience?
- **MCP server:** under an hour from zero to a working Streamable HTTP server with tools, thanks to the SDK and the spec.
- **MCP Apps:** about 2 hours. The concept is quick, but hosting our own `AppBridge` and writing bundler-free apps took reading type definitions rather than docs.
- **Strands TypeScript:** quick for the basics (`Agent`, `tool()`, `OpenAIModel`), but `McpClient` options and hook event shapes needed reading `.d.ts` files. It also needs `serverExternalPackages: ["@strands-agents/sdk"]` to build in Next.js 16 (the Turbopack build fails on an optional `@aws-sdk/client-s3` import).
- **Alexa+:** reading docs was easy, but "hello world" on a real Alexa+ client isn't possible without partner access, which is the biggest onboarding gap for this track.

## Feedback Q5: Would you build with these devices and services again?
Yes. MCP plus MCP Apps is a genuinely good way to ship one integration that works as voice on Alexa+ and as rich cards on a display, and Strands hooks gave us the deterministic safety layer a caregiving product needs. We'd build again once there's a self-serve Alexa+ developer stage for testing add-ons before becoming a partner.

## Feature requests (optional)
1. **Self-serve Alexa+ developer stage / web simulator for MCP add-ons.** Test account linking, MCP Apps rendering and latency without partner allowlisting. *Critical.*
2. **One authoritative account-linking contract** in the MCP Toolkit docs (401 vs 403, `WWW-Authenticate`, which well-known path), plus a conformance checker in the `alexa-ai` CLI. *Important.*
3. **Strands "required tool" steering primitive** and an `invoke()` result that lists executed vs. cancelled tool calls. *Important.*
4. **Small standalone MCP Apps client script** (< 20 KB) and a documented size-reporting pattern. *Nice-to-have.*
5. **Alexa+ Partner Wallet checkout for small developers**, so caregiver apps like Refill can complete purchases natively. *Important.*

## Friction log (optional URL field)
https://github.com/chinesepowered/refill/blob/main/FRICTION_LOG.md (the repo is private until the license is chosen; make it public before submitting).
