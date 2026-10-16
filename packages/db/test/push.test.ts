import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, deliverPendingNotifications } from "../src";

let planner: string, pdl: string, br: string, anna: string, ben: string, wardId: string, F: string;
const ok = (n: number) => new Response(JSON.stringify({ data: Array.from({ length: n }, () => ({ status: "ok", id: "x" })) }));

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben] = await Promise.all(["planer", "pdl", "br", "anna", "ben"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  F = (await prisma.shiftType.findFirstOrThrow({ where: { code: "F" } })).id;
});

describe("push delivery", () => {
  it("notifies reviewers on submit and the planner on decisions, and pushes to registered devices only", async () => {
    await prisma.deviceToken.createMany({ data: [
      { userId: pdl, platform: "IOS", token: "ExponentPushToken[pdl-ios]" },
      { userId: anna, platform: "ANDROID", token: "ExponentPushToken[anna-android]" },
      { userId: anna, platform: "WEB", token: "web-endpoint-ignored" },
    ] });
    const plan = await getOrCreatePlan(wardId, "2032-01-01");
    await setShift(plan.id, anna, planner, "2032-01-05", F);
    await submitPlan(plan.id, planner);
    expect(await prisma.notification.count({ where: { type: "REVIEW_REQUESTED", userId: { in: [pdl, br] } } })).toBeGreaterThanOrEqual(2);

    const calls: any[][] = [];
    const fake = (async (_u: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); calls.push(body); return ok(body.length); }) as unknown as typeof fetch;
    const r1 = await deliverPendingNotifications(fake);
    expect(r1.sent).toBe(1); // only pdl has a device; br has none
    expect(calls[0]![0]).toMatchObject({ to: "ExponentPushToken[pdl-ios]", title: "Dienstplan zur Prüfung" });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: pdl, type: "REVIEW_REQUESTED" } })).deliveredAt).not.toBeNull();
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: br, type: "REVIEW_REQUESTED" } })).deliveredAt).toBeNull();

    // nothing is sent twice
    calls.length = 0;
    expect((await deliverPendingNotifications(fake)).sent).toBe(0);

    await reviewPlan(plan.id, pdl, "APPROVED");
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);
    const r2 = await deliverPendingNotifications(fake);
    expect(r2.sent).toBe(1);
    expect(calls[0]![0]).toMatchObject({ to: "ExponentPushToken[anna-android]", title: "Dienstplan veröffentlicht" });
  });

  it("respects the user's push setting and removes dead device tokens", async () => {
    await prisma.user.update({ where: { id: ben }, data: { pushEnabled: false } });
    await prisma.deviceToken.createMany({ data: [
      { userId: ben, platform: "IOS", token: "ExponentPushToken[ben]" },
      { userId: anna, platform: "IOS", token: "ExponentPushToken[anna-dead]" },
    ] });
    const plan = await getOrCreatePlan(wardId, "2032-02-01");
    await setShift(plan.id, anna, planner, "2032-02-02", F);
    await setShift(plan.id, ben, planner, "2032-02-02", F);
    await submitPlan(plan.id, planner);
    await reviewPlan(plan.id, pdl, "APPROVED");
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);

    const sentTo: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { to: string }[];
      body.forEach((m) => sentTo.push(m.to));
      return new Response(JSON.stringify({ data: body.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })) }));
    }) as unknown as typeof fetch;
    const r = await deliverPendingNotifications(fake);
    expect(sentTo).not.toContain("ExponentPushToken[ben]");
    expect(r.removed).toBe(1);
    expect(await prisma.deviceToken.count({ where: { token: "ExponentPushToken[anna-dead]" } })).toBe(0);
  });

  it("never throws when the provider is down", async () => {
    const plan = await getOrCreatePlan(wardId, "2032-03-01");
    await setShift(plan.id, anna, planner, "2032-03-02", F);
    await submitPlan(plan.id, planner);
    const down = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await prisma.deviceToken.upsert({ where: { token: "ExponentPushToken[pdl-ios]" }, update: {}, create: { userId: pdl, platform: "IOS", token: "ExponentPushToken[pdl-ios]" } });
    await prisma.notification.deleteMany({ where: { pushAttemptedAt: null } });
    await reviewPlan(plan.id, pdl, "APPROVED"); // notifies the planner; make the planner reachable
    await prisma.deviceToken.create({ data: { userId: planner, platform: "IOS", token: "ExponentPushToken[planner]" } });
    await expect(deliverPendingNotifications(down)).resolves.toBeDefined();
    // retried later, not lost
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: planner, type: "REVIEW_DECISION" }, orderBy: { createdAt: "desc" } })).pushAttemptedAt).toBeNull();
  });
});
