import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, clientIp, loginBlockedFor, recordLoginFailure, recordLoginSuccess, resetRateLimits } from "./rateLimit.ts";

const T0 = 1_000_000;

test("blocks an account after 5 failures and unblocks after the window", () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) { assert.equal(loginBlockedFor("1.1.1.1", "a@x.de", T0 + i), null); recordLoginFailure("1.1.1.1", "a@x.de", T0 + i); }
  const wait = loginBlockedFor("1.1.1.1", "a@x.de", T0 + 10)!;
  assert.ok(wait > 14 * 60 && wait <= 15 * 60, `wait was ${wait}`);
  assert.equal(loginBlockedFor("1.1.1.1", "a@x.de", T0 + LIMITS.windowMs + 10), null);
});

test("email is case-insensitive; other accounts and IPs are not blocked by one account", () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) recordLoginFailure("1.1.1.1", i % 2 ? "A@X.de" : "a@x.de", T0);
  assert.ok(loginBlockedFor("1.1.1.1", "A@x.DE", T0 + 1));
  assert.equal(loginBlockedFor("1.1.1.1", "b@x.de", T0 + 1), null);
  assert.equal(loginBlockedFor("2.2.2.2", "a@x.de", T0 + 1), null);
});

test("an IP trying many accounts is blocked as a whole", () => {
  resetRateLimits();
  for (let i = 0; i < LIMITS.perIp; i++) recordLoginFailure("9.9.9.9", `user${i}@x.de`, T0);
  assert.ok(loginBlockedFor("9.9.9.9", "fresh@x.de", T0 + 1));
});

test("success clears the account counter", () => {
  resetRateLimits();
  for (let i = 0; i < 4; i++) recordLoginFailure("1.1.1.1", "a@x.de", T0);
  recordLoginSuccess("1.1.1.1", "a@x.de");
  recordLoginFailure("1.1.1.1", "a@x.de", T0 + 1);
  assert.equal(loginBlockedFor("1.1.1.1", "a@x.de", T0 + 2), null);
});

test("client IP header is only trusted behind the proxy", () => {
  const h = { get: (n: string) => (n === "x-forwarded-for" ? "5.5.5.5, 10.0.0.1" : null) };
  delete process.env.TRUST_PROXY;
  assert.equal(clientIp(h), "direct");
  process.env.TRUST_PROXY = "1";
  assert.equal(clientIp(h), "5.5.5.5");
  delete process.env.TRUST_PROXY;
});
