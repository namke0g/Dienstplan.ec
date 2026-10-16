import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { prisma, deliverPendingNotifications, registerWebPush, unregisterWebPush, WEB_PUSH_BODY, type WebSender, type WebTarget, type WebMessage } from "../src";

let anna: string, ben: string;
const noExpo = (async () => new Response(JSON.stringify({ data: [] }))) as unknown as typeof fetch;
const sub = (name: string): WebTarget => ({ endpoint: `https://push.example/${name}`, p256dh: `p256-${name}`, auth: `auth-${name}` });
function recorder(result: (t: WebTarget) => "ok" | "gone" | "error" = () => "ok") {
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
    const res = await deliverPendingNotifications(noExpo, r.send);
    expect(res.sent).toBe(1);
    expect(r.calls).toEqual([{ target: sub("anna-laptop"), msg: { title: "Dienstplan geändert", body: WEB_PUSH_BODY, urgent: true, url: "/benachrichtigungen" } }]);
    expect(r.calls[0]!.msg.body).not.toContain("Anna");
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).deliveredAt).not.toBeNull();
  });

  it("removes subscriptions the browser vendor reports as gone", async () => {
    await registerWebPush(anna, sub("old"));
    await registerWebPush(anna, sub("new"));
    await notify(anna);
    const r = recorder((t) => (t.endpoint.endsWith("old") ? "gone" : "ok"));
    const res = await deliverPendingNotifications(noExpo, r.send);
    expect(res).toMatchObject({ sent: 1, removed: 1 });
    expect((await prisma.deviceToken.findMany({ where: { userId: anna } })).map((d) => d.token)).toEqual(["https://push.example/new"]);
  });

  it("retries later when the push service fails transiently, but not if another device already got it", async () => {
    await registerWebPush(anna, sub("flaky"));
    const n = await notify(anna);
    await deliverPendingNotifications(noExpo, recorder(() => "error").send);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).pushAttemptedAt).toBeNull(); // released for retry
    const second = recorder();
    await deliverPendingNotifications(noExpo, second.send);
    expect(second.calls).toHaveLength(1);

    await registerWebPush(ben, sub("ben-a")); await registerWebPush(ben, sub("ben-b"));
    const m = await notify(ben);
    await deliverPendingNotifications(noExpo, recorder((t) => (t.endpoint.endsWith("ben-a") ? "error" : "ok")).send);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.deliveredAt).not.toBeNull();
    expect(after.pushAttemptedAt).not.toBeNull(); // not retried: one browser has it
  });

  it("respects the user's push setting, skips when Web Push is not configured, ignores subscriptions without keys", async () => {
    await registerWebPush(anna, sub("anna"));
    await prisma.user.update({ where: { id: anna }, data: { pushEnabled: false } });
    await notify(anna);
    const r = recorder();
    await deliverPendingNotifications(noExpo, r.send);
    expect(r.calls).toHaveLength(0);

    await registerWebPush(ben, sub("ben"));
    await notify(ben);
    await deliverPendingNotifications(noExpo, null); // VAPID not configured
    await prisma.deviceToken.create({ data: { userId: ben, platform: "WEB", token: "https://push.example/legacy-no-keys" } });
    await notify(ben);
    const r2 = recorder();
    await deliverPendingNotifications(noExpo, r2.send);
    expect(r2.calls.map((c) => c.target.endpoint)).toEqual(["https://push.example/ben"]);
  });

  it("phones and browsers of the same person both get the message; Expo never sees browser endpoints", async () => {
    await prisma.deviceToken.create({ data: { userId: anna, platform: "IOS", token: "ExponentPushToken[anna-phone]" } });
    await registerWebPush(anna, sub("anna-pc"));
    await notify(anna);
    const expoTargets: string[] = [];
    const expo = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { to: string; body: string }[];
      body.forEach((m) => expoTargets.push(m.to));
      return new Response(JSON.stringify({ data: body.map(() => ({ status: "ok" })) }));
    }) as unknown as typeof fetch;
    const r = recorder();
    const res = await deliverPendingNotifications(expo, r.send);
    expect(expoTargets).toEqual(["ExponentPushToken[anna-phone]"]);
    expect(r.calls.map((c) => c.target.endpoint)).toEqual(["https://push.example/anna-pc"]);
    expect(res.sent).toBe(2);
  });

  it("overlapping runs never send the same notification twice", async () => {
    await registerWebPush(anna, sub("anna"));
    for (let i = 0; i < 20; i++) await notify(anna, { title: `N${i}` });
    const r = recorder();
    const slow: WebSender = async (t, m) => { await new Promise((ok) => setTimeout(ok, 5)); return r.send(t, m); };
    await Promise.all([deliverPendingNotifications(noExpo, slow), deliverPendingNotifications(noExpo, slow), deliverPendingNotifications(noExpo, slow)]);
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
