import { CLIENT_ID, DEMO_SUBJECT, SCOPES, redirectAllowed } from "@/lib/oauth";
import { now, sign } from "@/lib/sign";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const base = new URL(req.url).origin;
  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? "");
  const redirectUri = get("redirect_uri");
  if (!redirectAllowed(redirectUri, base)) return new Response("redirect_uri not registered", { status: 400 });
  if (get("response_type") !== "code" || get("code_challenge_method") !== "S256" || !get("code_challenge")) {
    return new Response("PKCE S256 authorization code flow required", { status: 400 });
  }
  const resource = get("resource") || `${base}/api/mcp`;
  if (resource !== `${base}/api/mcp`) return new Response("unknown resource", { status: 400 });
  const scope = get("scope").split(" ").filter((s) => SCOPES.includes(s)).join(" ") || SCOPES.join(" ");
  const code = sign({ kind: "code", sub: DEMO_SUBJECT, client: get("client_id") || CLIENT_ID, redirect: redirectUri, challenge: get("code_challenge"), resource, scope, exp: now() + 300 });
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (get("state")) target.searchParams.set("state", get("state"));
  return Response.redirect(target.toString(), 303);
}
