// HMAC-signed tokens: OAuth codes, access/refresh tokens, and the household state blob.
// The state blob is how Refill remembers a household across sessions without a database in this demo;
// production would keep it server-side (e.g. DynamoDB) keyed by the linked account.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { seedHousehold, type Household } from "./domain";

function secret(): string {
  const s = process.env.REFILL_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("REFILL_SECRET is not set");
  return s ?? "dev-only-refill-secret";
}

function mac(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function sign(payload: object, compress = false): string {
  const json = Buffer.from(JSON.stringify(payload));
  const body = (compress ? "z" : "j") + (compress ? deflateRawSync(json) : json).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function verify<T extends { exp?: number }>(token: string | null | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 2) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const raw = Buffer.from(body.slice(1), "base64url");
    const payload = JSON.parse((body[0] === "z" ? inflateRawSync(raw) : raw).toString()) as T;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const now = () => Math.floor(Date.now() / 1000);

export interface AccessToken {
  kind: "access";
  sub: string;
  scope: string;
  aud: string;
  exp: number;
}

export function readBearer(req: Request, audience: string): AccessToken | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const tok = verify<AccessToken>(m?.[1]);
  return tok && tok.kind === "access" && tok.aud === audience ? tok : null;
}

export function loadState(token: string | null, sub: string): Household {
  const s = verify<{ kind: string; h: Household; exp?: number }>(token);
  if (s && s.kind === "state" && s.h.sub === sub && s.h.v === 1) return s.h;
  return seedHousehold(sub);
}

export function saveState(h: Household): string {
  return sign({ kind: "state", h }, true);
}

export function peekState(token: string | null): Household | null {
  const s = verify<{ kind: string; h: Household; exp?: number }>(token);
  return s && s.kind === "state" ? s.h : null;
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
