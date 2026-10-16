/**
 * Small in-memory limiter for login attempts (one instance of the app; use a shared store if you ever run several).
 * Keys expire on their own; only failed attempts count, a success clears the key.
 */
interface Bucket { fails: number[]; }
const buckets = new Map<string, Bucket>();

export const LIMITS = { windowMs: 15 * 60_000, perAccount: 5, perIp: 20 };

function recent(key: string, now: number): number[] {
  const b = buckets.get(key);
  if (!b) return [];
  b.fails = b.fails.filter((t) => now - t < LIMITS.windowMs);
  if (b.fails.length === 0) buckets.delete(key);
  return b.fails;
}

/** Returns the seconds to wait if this login attempt is blocked, otherwise null. */
export function loginBlockedFor(ip: string, email: string, now = Date.now()): number | null {
  const waits: number[] = [];
  for (const [key, max] of [[`acct:${email.toLowerCase()}|${ip}`, LIMITS.perAccount], [`ip:${ip}`, LIMITS.perIp]] as const) {
    const fails = recent(key, now);
    if (fails.length >= max) waits.push(Math.ceil((fails[fails.length - max]! + LIMITS.windowMs - now) / 1000));
  }
  return waits.length ? Math.max(...waits) : null;
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()) {
  for (const key of [`acct:${email.toLowerCase()}|${ip}`, `ip:${ip}`]) {
    const b = buckets.get(key) ?? { fails: [] };
    b.fails.push(now);
    buckets.set(key, b);
  }
  if (buckets.size > 10_000) for (const k of buckets.keys()) recent(k, now); // keep memory bounded
}

export function recordLoginSuccess(ip: string, email: string) {
  buckets.delete(`acct:${email.toLowerCase()}|${ip}`);
}

export const resetRateLimits = () => buckets.clear();

/** Client IP from the reverse proxy header. Only trusted when TRUST_PROXY=1 (i.e. behind Caddy), otherwise everyone shares one bucket per server. */
export function clientIp(headers: { get(name: string): string | null }): string {
  if (process.env.TRUST_PROXY === "1") {
    const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = headers.get("x-real-ip");
    if (real) return real;
  }
  return "direct";
}
