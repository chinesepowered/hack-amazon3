// Minimal OAuth 2.1 authorization server for the demo account link (authorization code + PKCE S256).
export const SCOPES = ["refill.read", "refill.order"];
export const CLIENT_ID = "refill-display-sim";
export const DEMO_SUBJECT = "household-walter";

const ALEXA_REDIRECT_HOSTS = ["pitangui.amazon.com", "layla.amazon.com", "alexa.amazon.co.jp"];

export function redirectAllowed(redirectUri: string, base: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.origin === base && u.pathname === "/link/callback") return true;
    return u.protocol === "https:" && ALEXA_REDIRECT_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Refill",
  };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  };
}
