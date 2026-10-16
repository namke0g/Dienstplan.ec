import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// a fake browser: one optional push subscription, a fetch that records requests, and the notification permission
const key = Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString("base64url");
const otherKey = Buffer.from(Array.from({ length: 65 }, (_, i) => 255 - i)).toString("base64url");
let requests: { method: string; body: unknown }[] = [];
let unsubscribed = 0;
let fetchDelayMs = 0;
function install(sub: { key: string } | null, permission = "granted") {
  requests = []; unsubscribed = 0; fetchDelayMs = 0;
  const subscription = sub && {
    endpoint: "https://fcm.googleapis.com/fcm/send/x",
    options: { applicationServerKey: Uint8Array.from(Buffer.from(sub.key, "base64url")).buffer },
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => { unsubscribed++; return true; },
  };
  const fakes: Record<string, unknown> = {
    window: globalThis,
    navigator: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) } },
    PushManager: function PushManager() {},
    Notification: { permission },
    fetch: async (_url: string, init: { method: string; body: string; signal?: AbortSignal }) => {
      requests.push({ method: init.method, body: JSON.parse(init.body) });
      if (fetchDelayMs) await new Promise((ok, fail) => { const t = setTimeout(ok, fetchDelayMs); init.signal?.addEventListener("abort", () => { clearTimeout(t); fail(new Error("aborted")); }); });
      return { ok: true };
    },
  };
  // Node has its own read-only `navigator`, so define every fake explicitly
  for (const [name, value] of Object.entries(fakes)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const mod = () => import(`./browserPush.ts?${Math.random()}`) as Promise<typeof import("./browserPush")>; // fresh module state per test

beforeEach(() => install(null));

test("a subscription made with an old server key is dropped instead of showing 'on' (#7)", async () => {
  install({ key: otherKey });
  const { syncHere } = await mod();
  assert.equal(await syncHere(key), false);
  assert.equal(unsubscribed, 1);
  assert.equal(requests.length, 0);
});

test("a valid subscription is re-registered for whoever is signed in now (#2)", async () => {
  install({ key });
  const { syncHere } = await mod();
  assert.equal(await syncHere(key), true);
  assert.deepEqual(requests.map((r) => r.method), ["POST"]);
});

test("without granted permission nothing is registered", async () => {
  install({ key }, "default");
  const { syncHere } = await mod();
  assert.equal(await syncHere(key), false);
  assert.equal(requests.length, 0);
});

test("one sync per page load is shared; 'fresh' forces another, e.g. after a password change (#1, #9)", async () => {
  install({ key });
  const { syncOnce } = await mod();
  await Promise.all([syncOnce(key), syncOnce(key)]);
  assert.equal(requests.length, 1);
  await syncOnce(key, true);
  assert.equal(requests.length, 2);
});

test("unsubscribing never takes longer than its limit, and the browser stops receiving anyway (#10)", async () => {
  install({ key });
  fetchDelayMs = 10_000; // server hangs
  const { unsubscribeHere } = await mod();
  const t0 = Date.now();
  await unsubscribeHere(200);
  assert.ok(Date.now() - t0 < 1000, "logout was held up");
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(unsubscribed, 1);
});
