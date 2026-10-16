import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, deliverPendingNotifications, registerWebPush, unregisterWebPush, WEB_PUSH_BODY, isAllowedPushEndpoint, classifyPushStatus,
  changePassword, resetPassword, createManagedUser, updateManagedUser, resetManagedPassword,
  type WebSender, type WebTarget, type WebMessage, type WebResult,
} from "../src";

process.env.WEB_PUSH_EXTRA_HOSTS = "push.example"; // the fake push service used in these tests

let anna: string, ben: string;
const sub = (name: string): WebTarget => ({ endpoint: `https://push.example/${name}`, p256dh: `p256-${name}`, auth: `auth-${name}` });
function recorder(result: (t: WebTarget) => WebResult = () => "ok") {
  const calls: { target: WebTarget; msg: WebMessage }[] = [];
  const send: WebSender = async (target, msg) => { calls.push({ target, msg }); return result(target); };
  return { calls, send };
}
const notify = (userId: string, o: { title?: string; body?: string; shortNotice?: boolean } = {}) =>
  prisma.notification.create({ data: { userId, type: "TEST", title: o.title ?? "Dienstplan geändert", body: o.body ?? "Anna, Frühdienst am 03.11. statt Spätdienst", shortNotice: o.shortNotice ?? false } });

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  [anna, ben] = await Promise.all(["anna", "ben"].map(async (n) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id));
});
beforeEach(async () => {
  await prisma.deviceToken.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.user.updateMany({ data: { pushEnabled: true } });
});

describe("Web Push channel", () => {
  it("sends a generic text (no names, dates or reasons) and marks the notification delivered", async () => {
    await registerWebPush(anna, sub("anna-laptop"));
    const n = await notify(anna, { shortNotice: true });
    const r = recorder();
    const res = await deliverPendingNotifications(r.send);
    expect(res.sent).toBe(1);
    expect(r.calls).toEqual([{ target: sub("anna-laptop"), msg: { id: n.id, title: "Dienstplan geändert", body: WEB_PUSH_BODY, urgent: true, url: "/benachrichtigungen" } }]);
    expect(r.calls[0]!.msg.body).not.toContain("Anna");
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).deliveredAt).not.toBeNull();
  });

  it("removes subscriptions the browser vendor reports as gone", async () => {
    await registerWebPush(anna, sub("old"));
    await registerWebPush(anna, sub("new"));
    await notify(anna);
    const r = recorder((t) => (t.endpoint.endsWith("old") ? "gone" : "ok"));
    const res = await deliverPendingNotifications(r.send);
    expect(res).toMatchObject({ sent: 1, removed: 1 });
    expect((await prisma.deviceToken.findMany({ where: { userId: anna } })).map((d) => d.token)).toEqual(["https://push.example/new"]);
  });

  it("retries later when the push service fails transiently, but not if another device already got it", async () => {
    await registerWebPush(anna, sub("flaky"));
    const n = await notify(anna);
    await deliverPendingNotifications(recorder(() => "error").send);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).pushAttemptedAt).toBeNull(); // released for retry
    const second = recorder();
    await deliverPendingNotifications(second.send);
    expect(second.calls).toHaveLength(1);

    await registerWebPush(ben, sub("ben-a")); await registerWebPush(ben, sub("ben-b"));
    const m = await notify(ben);
    await deliverPendingNotifications(recorder((t) => (t.endpoint.endsWith("ben-a") ? "error" : "ok")).send);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.deliveredAt).not.toBeNull();
    expect(after.pushAttemptedAt).not.toBeNull(); // not retried: one browser has it
    expect(after.pushClaimedUntil).toBeNull();
  });

  it("respects the user's push setting, skips when Web Push is not configured, ignores subscriptions without keys", async () => {
    await registerWebPush(anna, sub("anna"));
    await prisma.user.update({ where: { id: anna }, data: { pushEnabled: false } });
    await notify(anna);
    const r = recorder();
    await deliverPendingNotifications(r.send);
    expect(r.calls).toHaveLength(0);

    await registerWebPush(ben, sub("ben"));
    await notify(ben);
    await deliverPendingNotifications(null); // VAPID not configured
    await prisma.deviceToken.create({ data: { userId: ben, platform: "WEB", token: "https://push.example/legacy-no-keys" } });
    await notify(ben);
    const r2 = recorder();
    await deliverPendingNotifications(r2.send);
    expect(r2.calls.map((c) => c.target.endpoint)).toEqual(["https://push.example/ben"]);
  });

  it("overlapping runs never send the same notification twice", async () => {
    await registerWebPush(anna, sub("anna"));
    for (let i = 0; i < 20; i++) await notify(anna, { title: `N${i}` });
    const r = recorder();
    const slow: WebSender = async (t, m) => { await new Promise((ok) => setTimeout(ok, 5)); return r.send(t, m); };
    await Promise.all([deliverPendingNotifications(slow), deliverPendingNotifications(slow), deliverPendingNotifications(slow)]);
    const titles = r.calls.map((c) => c.msg.title);
    expect(titles).toHaveLength(20);
    expect(new Set(titles).size).toBe(20);
  });

  it("subscription management: moves an endpoint to the new user, caps browsers per person, unregisters only own", async () => {
    await registerWebPush(anna, sub("shared-pc"));
    await registerWebPush(ben, sub("shared-pc")); // Ben logs in on the same browser
    expect((await prisma.deviceToken.findUniqueOrThrow({ where: { token: "https://push.example/shared-pc" } })).userId).toBe(ben);
    for (let i = 0; i < 12; i++) { await registerWebPush(anna, sub(`b${i}`)); await new Promise((ok) => setTimeout(ok, 2)); }
    const annas = await prisma.deviceToken.findMany({ where: { userId: anna } });
    expect(annas).toHaveLength(10);
    expect(annas.map((d) => d.token)).not.toContain("https://push.example/b0"); // oldest dropped
    expect(await unregisterWebPush(anna, "https://push.example/shared-pc")).toBe(0); // not hers
    expect(await unregisterWebPush(ben, "https://push.example/shared-pc")).toBe(1);
  });
});

describe("review fixes", () => {
  it("#1 only real push services are accepted as endpoints (no requests to arbitrary or internal hosts)", async () => {
    delete process.env.WEB_PUSH_EXTRA_HOSTS;
    try {
      for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QO", "https://wns2-par02p.notify.windows.com/w/?token=x"])
        expect(isAllowedPushEndpoint(ok), ok).toBe(true);
      for (const bad of ["http://fcm.googleapis.com/x", "https://10.0.0.5:8443/admin", "https://localhost/x", "https://evil.example/x",
        "https://fcm.googleapis.com.evil.example/x", "https://evil-fcm.googleapis.com/x", "https://user:pw@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:8443/x", "not a url"])
        expect(isAllowedPushEndpoint(bad), bad).toBe(false);
      await expect(registerWebPush(anna, { endpoint: "https://10.0.0.5/x", p256dh: "a", auth: "b" })).rejects.toThrow(/not allowed/);
    } finally { process.env.WEB_PUSH_EXTRA_HOSTS = "push.example"; }
  });

  it("#1 a stored subscription to a non-push host is never contacted and gets removed", async () => {
    await prisma.deviceToken.create({ data: { userId: anna, platform: "WEB", token: "https://intranet.klinik.local/x", p256dh: "a", auth: "b" } });
    await notify(anna);
    const r = recorder();
    const res = await deliverPendingNotifications(r.send);
    expect(r.calls).toHaveLength(0);
    expect(res.removed).toBe(1);
  });

  it("#2 ending sessions on the server also ends the person's browser subscriptions", async () => {
    const u = (await createManagedUser(await adminId(), { name: "Pia Push", email: "pia.push@demo.de", role: "EMPLOYEE", password: "pia-passwort-123" })).user;
    const count = () => prisma.deviceToken.count({ where: { userId: u.id, platform: "WEB" } });
    await registerWebPush(u.id, sub("pia-1"));
    await registerWebPush(u.id, sub("pia-second-pc"));
    await changePassword(u.id, "pia-passwort-123", "pia-passwort-456");
    expect(await count()).toBe(0);
    expect(await prisma.deviceToken.count({ where: { userId: u.id } })).toBe(0); // every browser of that person
    await registerWebPush(u.id, sub("pia-2"));
    await resetManagedPassword(await adminId(), u.id);
    expect(await count()).toBe(0);
    await registerWebPush(u.id, sub("pia-3"));
    await resetPassword("pia.push@demo.de");
    expect(await count()).toBe(0);
    await registerWebPush(u.id, sub("pia-4"));
    await updateManagedUser(await adminId(), u.id, { name: "Pia P.", email: "pia.push@demo.de" }); // name only: sessions stay
    expect(await count()).toBe(1);
    await updateManagedUser(await adminId(), u.id, { name: "Pia P.", email: "pia.push@demo.de", role: "PLANNER" });
    expect(await count()).toBe(0);
  });

  it("#3 browsers are sent to in parallel, and a hanging one does not stall the run", async () => {
    for (let i = 0; i < 6; i++) await registerWebPush(anna, sub(`p${i}`));
    await notify(anna);
    const slow: WebSender = async () => { await new Promise((ok) => setTimeout(ok, 300)); return "ok"; };
    const t0 = Date.now();
    await deliverPendingNotifications(slow);
    expect(Date.now() - t0).toBeLessThan(1200); // sequential would be about 1.8 s
  });

  it("#4 push service answers are classified: dead subscriptions removed, temporary ones retried, others dropped", async () => {
    expect([200, 201].map(classifyPushStatus)).toEqual(["ok", "ok"]);
    expect([403, 404, 410].map(classifyPushStatus)).toEqual(["gone", "gone", "gone"]);
    expect([429, 500, 503, undefined].map(classifyPushStatus)).toEqual(["error", "error", "error", "error"]);
    expect([400, 401, 413].map(classifyPushStatus)).toEqual(["failed", "failed", "failed"]); // our request was rejected: keep the subscription

    await registerWebPush(anna, sub("rotated-key")); // e.g. VAPID keys were changed: 403 forever
    const n = await notify(anna);
    const res = await deliverPendingNotifications(recorder(() => classifyPushStatus(403)).send);
    expect(res.removed).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).pushAttemptedAt).not.toBeNull(); // not retried 288 times

    await registerWebPush(ben, sub("too-big"));
    const m = await notify(ben);
    await deliverPendingNotifications(recorder(() => "failed").send);
    expect(await prisma.deviceToken.count({ where: { token: "https://push.example/too-big" } })).toBe(1); // subscription kept
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: m.id } })).pushAttemptedAt).not.toBeNull(); // message not retried
  });

  it("#5 a notification claimed by a run that died is picked up again once the lease expires, not before", async () => {
    await registerWebPush(anna, sub("anna"));
    const n = await notify(anna);
    // a run claimed it and the process died before finishing
    await prisma.notification.update({ where: { id: n.id }, data: { pushClaimedUntil: new Date(Date.now() + 10 * 60_000) } });
    const r = recorder();
    await deliverPendingNotifications(r.send);
    expect(r.calls).toHaveLength(0); // lease still running: nobody else touches it
    await prisma.notification.update({ where: { id: n.id }, data: { pushClaimedUntil: new Date(Date.now() - 1000) } });
    await deliverPendingNotifications(r.send);
    expect(r.calls).toHaveLength(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).deliveredAt).not.toBeNull();
  });

  it("#5 if a run breaks off with an error, undelivered notifications are released, not marked done", async () => {
    await registerWebPush(anna, sub("anna"));
    const n = await notify(anna);
    const broken: WebSender = async () => { throw new Error("boom"); };
    await deliverPendingNotifications(broken);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.pushAttemptedAt).toBeNull();
    expect(after.pushClaimedUntil).toBeNull();
  });

  it("#6 a browser that moves to another person counts as newly seen and is not dropped by the limit", async () => {
    await registerWebPush(anna, sub("ward-pc")); // registered long ago by Anna
    await prisma.deviceToken.update({ where: { token: "https://push.example/ward-pc" }, data: { createdAt: new Date("2020-01-01"), lastSeenAt: new Date("2020-01-01") } });
    for (let i = 0; i < 10; i++) { await registerWebPush(ben, sub(`ben-${i}`)); await new Promise((ok) => setTimeout(ok, 2)); }
    await registerWebPush(ben, sub("ward-pc")); // Ben logs in on the ward PC
    const pc = await prisma.deviceToken.findUnique({ where: { token: "https://push.example/ward-pc" } });
    expect(pc?.userId).toBe(ben);
    expect(await prisma.deviceToken.count({ where: { userId: ben, platform: "WEB" } })).toBe(10);
    expect(await prisma.deviceToken.count({ where: { token: "https://push.example/ben-0" } })).toBe(0); // his oldest one went instead
  });

  it("#9 each message carries its own id, so the browser can keep messages apart", async () => {
    await registerWebPush(anna, sub("anna"));
    const a = await notify(anna, { title: "A", shortNotice: true });
    const b = await notify(anna, { title: "B" });
    const r = recorder();
    await deliverPendingNotifications(r.send);
    expect(r.calls.map((c) => c.msg.id).sort()).toEqual([a.id, b.id].sort());
  });
});

async function adminId() { return (await prisma.user.findUniqueOrThrow({ where: { email: "admin@demo.de" } })).id; }

describe("second review fixes", () => {
  it("#4 a run stops starting new sends at its deadline and leaves the rest for the next run (never outliving its lease)", async () => {
    process.env.PUSH_RUN_BUDGET_MS = "250";
    try {
      for (let i = 0; i < 30; i++) await registerWebPush(anna, sub(`d${i}`));
      const n = await notify(anna);
      const slow = recorder();
      const send: WebSender = async (t, m) => { await new Promise((ok) => setTimeout(ok, 100)); return slow.send(t, m); };
      const t0 = Date.now();
      await deliverPendingNotifications(send);
      expect(Date.now() - t0).toBeLessThan(1000); // 30 browsers × 100 ms / 10 parallel would be 300 ms+; stopped near 250 ms
      // only 10 browsers are kept per person; the run reached some of them, so the message counts as delivered
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).deliveredAt).not.toBeNull();
    } finally { delete process.env.PUSH_RUN_BUDGET_MS; }
  });

  it("#4 notifications whose turn did not come before the deadline are released, not marked done", async () => {
    process.env.PUSH_RUN_BUDGET_MS = "1";
    try {
      await registerWebPush(anna, sub("late"));
      const n = await notify(anna);
      await new Promise((ok) => setTimeout(ok, 5));
      await deliverPendingNotifications(recorder().send);
      const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(after.pushAttemptedAt).toBeNull();
      expect(after.pushClaimedUntil).toBeNull();
    } finally { delete process.env.PUSH_RUN_BUDGET_MS; }
  });

  it("#6 claiming and leases work the same whatever time zone the database server is set to", async () => {
    await prisma.$executeRawUnsafe(`ALTER ROLE dienstplan SET timezone = 'Etc/GMT-14'`); // UTC+14, the most extreme zone
    await prisma.$disconnect(); // new connections pick up the setting
    try {
      expect((await prisma.$queryRawUnsafe<{ tz: string }[]>("SELECT current_setting('TimeZone') AS tz"))[0]!.tz).toBe("Etc/GMT-14");
      await registerWebPush(anna, sub("tz"));
      const recent = await notify(anna, { title: "11 hours old" }); // still inside the 24 h window
      await prisma.notification.update({ where: { id: recent.id }, data: { createdAt: new Date(Date.now() - 11 * 3_600_000) } });
      const leased = await notify(anna, { title: "lease running" }); // claimed 5 minutes ago by a run that is still working
      await prisma.notification.update({ where: { id: leased.id }, data: { pushClaimedUntil: new Date(Date.now() + 10 * 60_000) } });
      const r = recorder();
      await deliverPendingNotifications(r.send);
      expect(r.calls.map((c) => c.msg.title)).toEqual(["11 hours old"]); // bug: in UTC+14 the first looked 25 h old and the lease looked expired
    } finally {
      await prisma.$executeRawUnsafe(`ALTER ROLE dienstplan RESET timezone`);
      await prisma.$disconnect();
    }
  });
});
