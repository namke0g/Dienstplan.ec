import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, deliverPendingNotifications, registerWebPush, type WebSender, type WebTarget } from "../src";

process.env.WEB_PUSH_EXTRA_HOSTS = "push.example"; // the fake push service used in these tests

let planner: string, pdl: string, br: string, anna: string, ben: string, wardId: string, F: string;
const sub = (name: string): WebTarget => ({ endpoint: `https://push.example/${name}`, p256dh: `p256-${name}`, auth: `auth-${name}` });
function recorder(result: (t: WebTarget) => "ok" | "gone" = () => "ok") {
  const calls: { endpoint: string; title: string }[] = [];
  const send: WebSender = async (t, m) => { calls.push({ endpoint: t.endpoint, title: m.title }); return result(t); };
  return { calls, send };
}

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben] = await Promise.all(["planer", "pdl", "br", "anna", "ben"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  F = (await prisma.shiftType.findFirstOrThrow({ where: { code: "F" } })).id;
});

describe("push delivery", () => {
  it("notifies reviewers on submit and the planner on decisions, and pushes to subscribed browsers only", async () => {
    await registerWebPush(pdl, sub("pdl-pc"));
    await registerWebPush(anna, sub("anna-pc"));
    const plan = await getOrCreatePlan(wardId, "2032-01-01");
    await setShift(plan.id, anna, planner, "2032-01-05", F);
    await submitPlan(plan.id, planner);
    expect(await prisma.notification.count({ where: { type: "REVIEW_REQUESTED", userId: { in: [pdl, br] } } })).toBeGreaterThanOrEqual(2);

    const r = recorder();
    const r1 = await deliverPendingNotifications(r.send);
    expect(r1.sent).toBe(1); // only the PDL has a subscribed browser; the Betriebsrat has none
    expect(r.calls[0]).toMatchObject({ endpoint: "https://push.example/pdl-pc", title: "Dienstplan zur Prüfung" });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: pdl, type: "REVIEW_REQUESTED" } })).deliveredAt).not.toBeNull();
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: br, type: "REVIEW_REQUESTED" } })).deliveredAt).toBeNull();

    // nothing is sent twice
    r.calls.length = 0;
    expect((await deliverPendingNotifications(r.send)).sent).toBe(0);

    await reviewPlan(plan.id, pdl, "APPROVED");
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);
    expect((await deliverPendingNotifications(r.send)).sent).toBe(1);
    expect(r.calls[0]).toMatchObject({ endpoint: "https://push.example/anna-pc", title: "Dienstplan veröffentlicht" });
  });

  it("respects the user's push setting and removes subscriptions the push service reports as gone", async () => {
    await prisma.user.update({ where: { id: ben }, data: { pushEnabled: false } });
    await registerWebPush(ben, sub("ben-pc"));
    await registerWebPush(anna, sub("anna-dead"));
    const plan = await getOrCreatePlan(wardId, "2032-02-01");
    await setShift(plan.id, anna, planner, "2032-02-02", F);
    await setShift(plan.id, ben, planner, "2032-02-02", F);
    await submitPlan(plan.id, planner);
    await reviewPlan(plan.id, pdl, "APPROVED");
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);

    const r = recorder((t) => (t.endpoint.includes("dead") ? "gone" : "ok"));
    const res = await deliverPendingNotifications(r.send);
    expect(r.calls.map((c) => c.endpoint)).not.toContain("https://push.example/ben-pc");
    expect(res.removed).toBe(1);
    expect(await prisma.deviceToken.count({ where: { token: "https://push.example/anna-dead" } })).toBe(0);
  });

  it("never throws when the push service is down, and retries later", async () => {
    const plan = await getOrCreatePlan(wardId, "2032-03-01");
    await setShift(plan.id, anna, planner, "2032-03-02", F);
    await submitPlan(plan.id, planner);
    await prisma.notification.deleteMany({ where: { pushAttemptedAt: null } });
    await reviewPlan(plan.id, pdl, "APPROVED"); // notifies the planner; make the planner reachable
    await registerWebPush(planner, sub("planner-pc"));
    const down: WebSender = async () => { throw new Error("network down"); };
    await expect(deliverPendingNotifications(down)).resolves.toBeDefined();
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: planner, type: "REVIEW_DECISION" }, orderBy: { createdAt: "desc" } })).pushAttemptedAt).toBeNull();
  });
});
