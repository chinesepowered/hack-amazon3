"use client";
// Browser side of the demo account link: OAuth 2.1 authorization code + PKCE, token storage and refresh.

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const KEY = "refill.tokens";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function saveTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
  const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  localStorage.setItem(KEY, JSON.stringify(tokens));
  return tokens;
}

export function clearTokens() {
  localStorage.removeItem(KEY);
}

export async function startLink() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem("refill.pkce", JSON.stringify({ verifier, state }));
  const origin = window.location.origin;
  const url = new URL("/oauth/authorize", origin);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: "refill-display-sim",
    redirect_uri: `${origin}/link/callback`,
    scope: "refill.read refill.order",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${origin}/api/mcp`,
  }).toString();
  window.location.assign(url.toString());
}

export async function finishLink(code: string, state: string): Promise<Tokens> {
  const saved = JSON.parse(sessionStorage.getItem("refill.pkce") ?? "{}") as { verifier?: string; state?: string };
  if (!saved.verifier || saved.state !== state) throw new Error("Link state mismatch. Start linking again.");
  const origin = window.location.origin;
  const res = await fetch("/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${origin}/link/callback`, client_id: "refill-display-sim", code_verifier: saved.verifier, resource: `${origin}/api/mcp` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description ?? "Token exchange failed");
  sessionStorage.removeItem("refill.pkce");
  return saveTokens(json);
}

export async function accessToken(): Promise<string | null> {
  const t = loadTokens();
  if (!t) return null;
  if (t.expires_at - Date.now() > 60_000) return t.access_token;
  const res = await fetch("/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  return saveTokens(await res.json()).access_token;
}
