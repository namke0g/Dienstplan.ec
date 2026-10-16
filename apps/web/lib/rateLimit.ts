/**
 * Small in-memory limiter for login attempts (one instance of the app; use a shared store if you ever run several).
 * Keys expire on their own; only failed attempts count, a success clears the key.
 */
interface Bucket { fails: number[]; }
const buckets = new Map<string, Bucket>();

/**
 * perPair: one account from one address; perAccount: one account from anywhere (guessing spread over many addresses);
 * perIp: one address for all accounts — high, because a whole hospital may share one NAT address.
 */
export const LIMITS = { windowMs: 15 * 60_000, perPair: 5, perAccount: 10, perIp: 60 };

function recent(key: string, now: number): number[] {
  const b = buckets.get(key);
  if (!b) return [];
  b.fails = b.fails.filter((t) => now - t < LIMITS.windowMs);
  if (b.fails.length === 0) buckets.delete(key);
  return b.fails;
}

const keysFor = (ip: string, email: string) => {
  const e = email.toLowerCase();
  return [[`pair:${e}|${ip}`, LIMITS.perPair], [`acct:${e}`, LIMITS.perAccount], [`ip:${ip}`, LIMITS.perIp]] as const;
};

/** Returns the seconds to wait if this login attempt is blocked, otherwise null. */
export function loginBlockedFor(ip: string, email: string, now = Date.now()): number | null {
  const waits: number[] = [];
  for (const [key, max] of keysFor(ip, email)) {
    const fails = recent(key, now);
    if (fails.length >= max) waits.push(Math.ceil((fails[fails.length - max]! + LIMITS.windowMs - now) / 1000));
  }
  return waits.length ? Math.max(...waits) : null;
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()) {
  for (const [key] of keysFor(ip, email)) {
    const b = buckets.get(key) ?? { fails: [] };
    b.fails.push(now);
    buckets.set(key, b);
  }
  if (buckets.size > 10_000) for (const k of buckets.keys()) recent(k, now); // keep memory bounded
}

/**
 * Checks and, if allowed, counts the attempt as failed right away — before the (slow) password check, so parallel requests
 * cannot all pass the check first. A correct password then calls recordLoginSuccess, a non-password error releaseAttempt.
 */
export function beginLoginAttempt(ip: string, email: string, now = Date.now()): number | null {
  const wait = loginBlockedFor(ip, email, now);
  if (wait === null) recordLoginFailure(ip, email, now);
  return wait;
}

/** Takes back the attempt counted by beginLoginAttempt (the request failed for another reason than the password). */
export function releaseAttempt(ip: string, email: string) {
  for (const [key] of keysFor(ip, email)) { const b = buckets.get(key); b?.fails.pop(); if (b && !b.fails.length) buckets.delete(key); }
}

/** Correct password: the pair and account start over; the address keeps its count (a valid own account must not reset it). */
export function recordLoginSuccess(ip: string, email: string) {
  const e = email.toLowerCase();
  buckets.delete(`pair:${e}|${ip}`);
  buckets.delete(`acct:${e}`);
  const b = buckets.get(`ip:${ip}`); b?.fails.pop(); if (b && !b.fails.length) buckets.delete(`ip:${ip}`);
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
