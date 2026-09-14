import { now, pkceS256, sign, verify } from "@/lib/sign";

export const runtime = "nodejs";

interface Code { kind: string; sub: string; client: string; redirect: string; challenge: string; resource: string; scope: string; exp: number }
interface Refresh { kind: string; sub: string; resource: string; scope: string; exp: number }

const err = (error: string, description: string) => Response.json({ error, error_description: description }, { status: 400 });

function issue(sub: string, resource: string, scope: string) {
  return Response.json(
    {
      access_token: sign({ kind: "access", sub, scope, aud: resource, exp: now() + 3600 }),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: sign({ kind: "refresh", sub, resource, scope, exp: now() + 30 * 86400 }),
      scope,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = verify<Code>(form.get("code"));
    if (!code || code.kind !== "code") return err("invalid_grant", "Code is invalid or expired.");
    if (form.get("redirect_uri") !== code.redirect) return err("invalid_grant", "redirect_uri mismatch.");
    const verifier = form.get("code_verifier") ?? "";
    if (!verifier || pkceS256(verifier) !== code.challenge) return err("invalid_grant", "PKCE verification failed.");
    const resource = form.get("resource") ?? code.resource;
    if (resource !== code.resource) return err("invalid_target", "resource mismatch.");
    return issue(code.sub, code.resource, code.scope);
  }
  if (grant === "refresh_token") {
    const rt = verify<Refresh>(form.get("refresh_token"));
    if (!rt || rt.kind !== "refresh") return err("invalid_grant", "Refresh token is invalid or expired.");
    return issue(rt.sub, rt.resource, rt.scope);
  }
  return err("unsupported_grant_type", "Use authorization_code or refresh_token.");
}
