import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/** Loads public/sw.js into a fake service-worker global and returns its listeners plus what it did. */
function loadWorker(openWindows: { url: string; controlled?: boolean }[] = []) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const claimed: boolean[] = [];
  const skipped: boolean[] = [];
  const self = {
    location: { origin: "https://dienstplan.example.de" },
    skipWaiting: async () => { skipped.push(true); },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    clients: {
      // like real browsers: navigate() resolves to the window, and rejects for tabs this worker does not control
      matchAll: async () => openWindows.map((w) => {
        const win = { url: w.url, focus: async () => win, navigate: async (u: string) => { if (w.controlled === false) throw new TypeError("not controlled"); navigated.push(u); return win; } };
        return win;
      }),
      claim: async () => { claimed.push(true); },
      openWindow: async (u: string) => { opened.push(u); },
    },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { self, URL });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  return { fire, shown, opened, navigated, claimed, skipped };
}
const pushEvent = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });

test("shows the server's title and generic text; urgent messages stay until dismissed", async () => {
  const w = loadWorker();
  await w.fire("push", pushEvent({ title: "Kurzfristige Änderung", body: "Es gibt eine neue Mitteilung.", urgent: true, url: "/benachrichtigungen" }));
  assert.equal(w.shown[0]!.title, "Kurzfristige Änderung");
  assert.equal(w.shown[0]!.options.requireInteraction, true);
  assert.equal((w.shown[0]!.options.data as { url: string }).url, "/benachrichtigungen"); // object comes from the worker sandbox (other realm)
});

test("falls back to a neutral notification for a missing or broken payload", async () => {
  const w = loadWorker();
  await w.fire("push", { data: null });
  await w.fire("push", pushEvent("{not json"));
  assert.deepEqual(w.shown.map((s) => s.title), ["Dienstplan", "Dienstplan"]);
  assert.equal(w.shown[0]!.options.requireInteraction, false);
});

test("a click only ever opens pages of this app, never a URL from the payload", async () => {
  const w = loadWorker();
  await w.fire("push", pushEvent({ title: "x", url: "https://evil.example/phish" }));
  await w.fire("notificationclick", { notification: { close() {}, data: w.shown[0]!.options.data } });
  assert.deepEqual(w.opened, ["https://dienstplan.example.de/"]);
});

test("a click reuses an open app window instead of opening another", async () => {
  const w = loadWorker([{ url: "https://dienstplan.example.de/mein-plan" }]);
  await w.fire("notificationclick", { notification: { close() {}, data: { url: "/benachrichtigungen" } } });
  assert.deepEqual(w.navigated, ["https://dienstplan.example.de/benachrichtigungen"]);
  assert.deepEqual(w.opened, []);
});

test("#8 the worker takes control right away, so it can steer open tabs", async () => {
  const w = loadWorker();
  await w.fire("install", {});
  await w.fire("activate", {});
  assert.equal(w.skipped.length, 1);
  assert.equal(w.claimed.length, 1);
});

test("#8 a click on a tab the worker does not control still opens the page", async () => {
  const w = loadWorker([{ url: "https://dienstplan.example.de/kalender", controlled: false }]);
  await w.fire("notificationclick", { notification: { close() {}, data: { url: "/benachrichtigungen" } } });
  assert.deepEqual(w.opened, ["https://dienstplan.example.de/benachrichtigungen"]);
});

test("#9 each message gets its own tag, so a routine message cannot replace an urgent one", async () => {
  const w = loadWorker();
  await w.fire("push", pushEvent({ id: "n1", title: "Kurzfristige Änderung", urgent: true }));
  await w.fire("push", pushEvent({ id: "n2", title: "Neuer Antrag" }));
  await w.fire("push", pushEvent({ id: "n1", title: "Kurzfristige Änderung", urgent: true })); // re-sent: replaces itself only
  assert.deepEqual(w.shown.map((s) => s.options.tag), ["dienstplan-n1", "dienstplan-n2", "dienstplan-n1"]);
  assert.equal(w.shown[0]!.options.requireInteraction, true);
});
