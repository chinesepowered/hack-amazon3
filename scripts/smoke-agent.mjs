// Runs the demo conversation through the Strands agent route and prints MCP calls, hook verdicts and replies.
// Usage: BASE=http://localhost:3023 node scripts/smoke-agent.mjs
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3023";
const MCP = `${BASE}/api/mcp`;

async function link() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = `${BASE}/link/callback`;
  const approve = await fetch(`${BASE}/api/oauth/approve`, {
    method: "POST",
    body: new URLSearchParams({ response_type: "code", client_id: "smoke", redirect_uri: redirect, scope: "refill.read refill.order", state: "x", code_challenge: challenge, code_challenge_method: "S256", resource: MCP }),
    redirect: "manual",
  });
  const code = new URL(approve.headers.get("location")).searchParams.get("code");
  const tok = await (await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier, resource: MCP }) })).json();
  return tok.access_token;
}

const token = await link();
let state = null;
const history = [];

async function turn(text) {
  const t0 = Date.now();
  console.log(`\n>>> ${text}`);
  const res = await fetch(`${BASE}/api/agent`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ text, history: history.slice(-8), state }) });
  if (!res.ok) throw new Error(`agent ${res.status}: ${await res.text()}`);
  const body = await res.text();
  let reply = "";
  for (const line of body.split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.type === "mcp" && e.method === "tools/call" && e.phase === "request") console.log(`   -> ${e.tool} ${JSON.stringify(e.args ?? {})}`);
    if (e.type === "mcp" && e.method === "tools/call" && e.phase === "response") console.log(`   <- ${e.tool} ${e.isError ? "ERROR " : ""}${(e.text ?? "").slice(0, 110)}${e.resourceUri ? ` [${e.resourceUri}]` : ""}`);
    if (e.type === "hook") console.log(`   ## ${e.verdict.toUpperCase()} ${e.tool} (${e.rule}): ${e.reason}`);
    if (e.type === "say") reply = e.text;
    if (e.type === "error") console.log(`   !! ${e.message}`);
    if (e.type === "state") state = e.token;
  }
  console.log(`<<< ${reply}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  history.push({ role: "user", text }, { role: "assistant", text: reply });
}

const script = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "What's running low at Dad's?",
      "Order what he needs, and refill his lisinopril.",
      "Confirm order ORD-001 for $99.94",
      "Yes, request the Lisinopril refill (RX-40218)",
      "Can he take an extra lisinopril if his blood pressure is high?",
      "Send the family this week's update.",
    ];
for (const line of script) await turn(line);
