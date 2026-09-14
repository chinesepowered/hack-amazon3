# Friction log

Real friction we hit while building Refill (Alexa+ track, Sep 14 2026). Each entry: task, steps, expected vs actual, severity, workaround, suggestion.

Severity scale: **High** (blocks shipping or forces a redesign), **Medium** (costs an hour or more, or risks a non-compliant build), **Low** (annoyance).

---

## 1. Alexa+ docs disagree on the unauthenticated response and the metadata path

- **Task:** Make Refill's MCP server trigger Alexa+ account linking correctly.
- **Steps:** Read the MCP Toolkit quickstart (`/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html`), then the account-linking page (`/docs/alexaplus/add-ons/mcp-toolkit-account-linking.html`), then MCP spec 2025-11-25 (Authorization).
- **Expected:** One consistent contract.
- **Actual:**
  - The quickstart says to return "401 Unauthorized (without a WWW-Authenticate header)" and host the metadata at `/.well-known/oauth-authorization-server`.
  - The account-linking page says to return "401 or 403" and host Protected Resource Metadata at `/.well-known/oauth-protected-resource`.
  - The MCP spec requires servers to send `WWW-Authenticate` with `resource_metadata` on 401.
- **Severity:** Medium. A wrong choice silently breaks linking on one side or the other, and there's no partner sandbox to test against.
- **Workaround:** We follow the MCP spec (401 + `WWW-Authenticate: Bearer resource_metadata=…`) and serve **both** well-known documents (`app/api/mcp/route.ts`, `app/.well-known/*`).
- **Suggestion:** Make the quickstart and the account-linking page state one contract. Say explicitly whether Alexa+ tolerates a `WWW-Authenticate` header. Link to a conformance checker.

## 2. No way for non-partners to deploy or test against real Alexa+

- **Task:** Try the add-on on a real Alexa+ device or simulator.
- **Steps:** Followed the docs home and the Builders page (`developer.amazon.com/en-US/alexa/alexa-ai`).
- **Expected:** A developer sandbox, even if it's rate-limited.
- **Actual:** Deployment is "available to select partners only". The `alexa-ai` CLI flow (`configure`, `new mcp`, `deploy`) can't be exercised end to end without allowlisting.
- **Severity:** High for this track. We had to build our own "simulated Alexa+ display" (voice, captions, MCP Apps host) to demo the experience.
- **Workaround:** A self-hosted MCP server plus a Strands-agent-driven display simulator that renders the same `ui://` MCP Apps the server ships.
- **Suggestion:** Offer hackathon participants a time-boxed dev-stage allowlist, or publish the web simulator standalone so MCP servers can be tested before partnership.

## 3. `@modelcontextprotocol/ext-apps` server helper types reject `description` on app resources

- **Task:** Register `ui://refill/*` HTML resources with a description.
- **Steps:** `registerAppResource(server, name, uri, { description, mimeType: RESOURCE_MIME_TYPE, _meta: { ui } }, cb)` with ext-apps 2.0.0 and `@modelcontextprotocol/sdk` 1.30.0.
- **Expected:** Compiles; plain `server.registerResource` accepts `description`.
- **Actual:** `TS2353: Object literal may only specify known properties, and 'description' does not exist in type 'McpUiAppResourceConfig'`.
- **Severity:** Low.
- **Workaround:** Cast the config (`lib/mcp/server.ts`).
- **Suggestion:** Base `McpUiAppResourceConfig` on the SDK's resource metadata type so `title`, `description` and `annotations` are allowed.

## 4. `registerAppTool` callback arguments aren't inferred with zod 4

- **Task:** Register MCP App tools with zod input shapes.
- **Steps:** `registerAppTool(server, "draft_refill_order", { inputSchema: { coverDays: z.number().optional() }, _meta: { ui: { resourceUri } } }, async ({ coverDays }) => …)` with zod 4.6.
- **Expected:** `coverDays` typed as `number | undefined`, as with `McpServer.registerTool`.
- **Actual:** `TS7031: Binding element 'coverDays' implicitly has an 'any' type` on every tool.
- **Severity:** Low. Every callback needed explicit parameter types.
- **Workaround:** Annotate parameter types by hand.
- **Suggestion:** Reuse the SDK's `ZodRawShapeCompat` / `ToolCallback` generics in ext-apps so inference matches `registerTool`.

## 5. Writing an MCP App without a bundler means hand-rolling the postMessage protocol

- **Task:** Ship self-contained `ui://` HTML that works in any MCP Apps host.
- **Steps:** Looked at `@modelcontextprotocol/ext-apps` for a script to inline. `app.js` imports its dependencies, and `app-with-deps.js` is 418 KB.
- **Expected:** A small (< 20 KB) standalone App client, or a CDN build mentioned in the docs.
- **Actual:** No lightweight standalone build, so we implemented `ui/initialize`, `ui/notifications/initialized`, `tool-result`, `size-changed` and `ui/message` by hand (`lib/mcp/ui.ts`). We also hit a sizing pitfall: reporting `document.documentElement.scrollHeight` never shrinks below the iframe's current height, so short cards kept a large empty area.
- **Severity:** Medium.
- **Workaround:** Our own ~20-line runtime; measure the content root's bounding box instead.
- **Suggestion:** Publish a minified standalone App client, and document the size-reporting pattern.

## 6. Stateless Streamable HTTP servers get a noisy 405 from browser clients

- **Task:** Use `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` in the browser against our stateless (JSON response) server.
- **Expected:** The client knows no standalone SSE stream exists when the server is stateless.
- **Actual:** The client opens a GET for the server-to-client stream, receives our `405`, and the browser console logs "Failed to load resource: 405". It works, but looks like an error in demos.
- **Severity:** Low.
- **Workaround:** None needed functionally; documented.
- **Suggestion:** Let servers advertise "no standalone SSE" at initialize, or have the client skip the GET when `enableJsonResponse` servers don't return a session id.

## 7. Strands agent claimed actions it never took when a tool was blocked

- **Task:** Enforce "prescription refills need explicit caregiver OK" with a Strands `BeforeToolCallEvent` hook.
- **Steps:** The hook sets `event.cancel = "reason"` on `request_prescription_refill`. User message: "Order what he needs, and refill his lisinopril."
- **Expected:** The model reports that the refill is waiting for approval, and still calls `draft_refill_order`.
- **Actual (Qwen3.8-27B via `OpenAIModel`):** The model received the cancel reason, called no other tool, and replied "I've sent the Lisinopril refill request… I've also put together a restock order". Neither was true. On later turns with text history, it answered "Done, order placed" without calling `place_order`.
- **Severity:** High for safety-critical flows. The hook blocked the action, but the spoken reply was false.
- **Workaround:**
  - Deterministic intent routing names the required tool for each request.
  - A steering pass re-invokes the agent if that tool wasn't executed.
  - The cancel reason says "It has NOT happened".
  - Tool execution is verified from the MCP wire, not from the model's text (`lib/agent.ts`).
- **Suggestion:** Strands could offer a first-class "required tool / must-call" steering primitive and an `AfterInvocationEvent` helper that exposes cancelled vs executed tool calls, so apps can reject replies that contradict tool outcomes.
