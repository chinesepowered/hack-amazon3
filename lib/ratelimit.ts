// Per-IP sliding window. In-memory, so it resets per serverless instance: enough to stop casual key draining.
const hits = new Map<string, number[]>();

export function rateLimit(req: Request, limit = 24, windowMs = 10 * 60_000): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
