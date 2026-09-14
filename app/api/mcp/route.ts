// Refill's self-hosted MCP endpoint: MCP spec 2025-11-25 over Streamable HTTP (stateless, JSON responses).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/lib/mcp/server";
import { loadState, readBearer, saveState } from "@/lib/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return true; // server-to-server clients (agents, inspector) send no Origin
  const self = new URL(req.url).origin;
  const extra = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin === self || extra.includes(origin);
}

async function handle(req: Request): Promise<Response> {
  if (!allowedOrigin(req)) return new Response("Forbidden origin", { status: 403 });
  const base = new URL(req.url).origin;
  const token = readBearer(req, `${base}/api/mcp`);
  if (!token) {
    return Response.json(
      { error: "invalid_token", error_description: "Link your Refill account (OAuth 2.1 + PKCE) to use this add-on." },
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` } },
    );
  }

  const ctx = { h: loadState(req.headers.get("x-refill-state"), token.sub) };
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const body = await res.text();
    const headers = new Headers(res.headers);
    headers.set("x-refill-state", saveState(ctx.h));
    headers.set("access-control-expose-headers", "x-refill-state");
    return new Response(body || null, { status: res.status, headers });
  } finally {
    await server.close();
  }
}

export const POST = handle;

export async function GET() {
  return new Response("This MCP server is stateless: POST JSON-RPC messages to this URL.", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
