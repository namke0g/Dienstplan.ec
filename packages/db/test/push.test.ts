import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { prisma, dispatchPending, notifyUser, registerWebPush, GENERIC_BODY, type PushSender } from "../src";

let anna: string, ben: string, cem: string;

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { cwd: process.cwd(), stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [anna, ben, cem] = await Promise.all([u("anna"), u("ben"), u("planer")]);
  await prisma.notification.deleteMany({});
  await prisma.deviceToken.deleteMany({});
});

describe("push dispatch", () => {
  it("sends generic text, marks delivered, drops dead subscriptions and retries transient failures", async () => {
    await registerWebPush(anna, { endpoint: "https://push.example/a-ok", p256dh: "k", auth: "a" });
    await registerWebPush(anna, { endpoint: "https://push.example/a-gone", p256dh: "k", auth: "a" });
    await registerWebPush(ben, { endpoint: "https://push.example/b-flaky", p256dh: "k", auth: "a" });
    await notifyUser(anna, { type: "SHIFT_CHANGED", title: "Kurzfristige Änderung", body: "Früh am 05.01. -> Spät", shortNotice: true });
    await notifyUser(ben, { type: "LEAVE_APPROVED", title: "Urlaub genehmigt", body: "secret detail" });
    await notifyUser(cem, { type: "PLAN_PUBLISHED", title: "Plan online", body: "x" }); // no device: in-app only

    const seen: { url: string; body: string; urgent: boolean }[] = [];
    let flaky = true;
    const send: PushSender = async (t, m) => {
      seen.push({ url: t.token, body: m.body, urgent: m.urgent });
      if (t.token.endsWith("a-gone")) return "gone";
      if (t.token.endsWith("b-flaky") && flaky) return "error";
      return "ok";
    };

    const r1 = await dispatchPending(send);
    expect(r1).toMatchObject({ processed: 3, sent: 1, failed: 1 });
    expect(seen.every((s) => s.body === GENERIC_BODY)).toBe(true);
    expect(seen.find((s) => s.url.endsWith("a-ok"))?.urgent).toBe(true);
    expect(await prisma.deviceToken.count({ where: { token: { endsWith: "a-gone" } } })).toBe(0);
    const pending = await prisma.notification.findMany({ where: { deliveredAt: null } });
    expect(pending.map((n) => n.userId)).toEqual([ben]); // only the transient failure is retried

    flaky = false;
    expect(await dispatchPending(send)).toMatchObject({ processed: 1, sent: 1 });
    expect(await prisma.notification.count({ where: { deliveredAt: null } })).toBe(0);
  });
});
