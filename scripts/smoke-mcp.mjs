// End-to-end check of the Refill MCP server: auth discovery, OAuth + PKCE link, MCP 2025-11-25 over Streamable HTTP,
// MCP Apps resources, business rules. Usage: BASE=http://localhost:3023 node scripts/smoke-mcp.mjs
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://localhost:3023";
const MCP = `${BASE}/api/mcp`;
let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};

// 1. Unauthenticated request -> 401 with protected resource metadata pointer
const unauth = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
check("401 without token", unauth.status === 401, unauth.headers.get("www-authenticate") ?? "");
const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
check("protected resource metadata", prm.resource === MCP && prm.authorization_servers?.[0] === BASE);
const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
check("authorization server supports S256", asm.code_challenge_methods_supported?.includes("S256"));

// 2. Bad Origin -> 403
const evil = await fetch(MCP, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
check("403 for foreign Origin", evil.status === 403);

// 3. OAuth authorization code + PKCE
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const redirect = `${BASE}/link/callback`;
const form = new URLSearchParams({ response_type: "code", client_id: "smoke", redirect_uri: redirect, scope: "refill.read refill.order", state: "s1", code_challenge: challenge, code_challenge_method: "S256", resource: MCP });
const approve = await fetch(`${BASE}/api/oauth/approve`, { method: "POST", body: form, redirect: "manual" });
const code = new URL(approve.headers.get("location")).searchParams.get("code");
check("authorization code issued", Boolean(code));
const badPkce = await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: "wrong", resource: MCP }) });
check("wrong PKCE verifier rejected", badPkce.status === 400);
const tok = await (await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier, resource: MCP }) })).json();
check("access token issued", Boolean(tok.access_token) && tok.token_type === "Bearer");

// 4. MCP session with state carried in x-refill-state
let state = null;
const fetchWithState = async (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${tok.access_token}`);
  if (state) headers.set("x-refill-state", state);
  const res = await fetch(url, { ...init, headers });
  state = res.headers.get("x-refill-state") ?? state;
  return res;
};
const client = new Client({ name: "refill-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(MCP), { fetch: fetchWithState });
await client.connect(transport);
check("negotiated protocol 2025-11-25", transport.protocolVersion === "2025-11-25", transport.protocolVersion);
const { tools } = await client.listTools();
const withUi = tools.filter((t) => t._meta?.ui?.resourceUri);
check("tools listed", tools.length >= 8, `${tools.length} tools, ${withUi.length} with ui://`);
const { resources } = await client.listResources();
check("MCP Apps resources", resources.length === 4 && resources.every((r) => r.mimeType === "text/html;profile=mcp-app"));
const html = await client.readResource({ uri: "ui://refill/checkout" });
check("checkout UI html", html.contents[0].text.includes("ui/initialize"));

const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const status = await call("get_supply_status");
check("status: briefs critical", status.structuredContent.items[0].id === "briefs" && status.structuredContent.items[0].status === "critical");
const draft = await call("draft_refill_order");
const orderId = draft.structuredContent.order.id;
check("draft order", draft.structuredContent.order.lines.length === 4, `${orderId} $${draft.structuredContent.order.total}`);
check("rx due listed", draft.structuredContent.rxDue[0]?.rxId === "RX-40218");
const placed = await call("place_order", { orderId });
check("order placed", placed.structuredContent.order.status === "placed", placed.content[0].text);
const again = await call("place_order", { orderId });
check("duplicate order blocked", again.isError === true, again.content[0].text);
const qty = await call("request_prescription_refill", { rxId: "RX-40218", quantity: 180 });
check("rx quantity locked", qty.isError === true, qty.content[0].text);
const rx = await call("request_prescription_refill", { rxId: "RX-40218" });
check("rx refill requested", rx.structuredContent.rxRequests.length === 1);
const q = await call("ask_pharmacist", { question: "Can he take an extra lisinopril if his blood pressure is high?" });
check("pharmacist handoff", q.structuredContent.kind === "pharmacist");
const later = await call("simulate_days", { days: 3 });
check("3 days later: order delivered", later.structuredContent.items.find((i) => i.id === "briefs").daysLeft > 7);
const digest = await call("send_family_digest");
check("digest built", digest.structuredContent.highlights.length >= 4, `${digest.structuredContent.highlights.length} highlights`);
await client.close();

// 5. Agent route health
const health = await (await fetch(`${BASE}/api/agent`)).json();
check("agent route configured", health.configured === true && health.agent.includes("Strands"));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
