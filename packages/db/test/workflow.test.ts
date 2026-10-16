import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, ForbiddenError } from "../src";

let wardId: string, planner: string, pdl: string, br: string, anna: string, ben: string, F: string, S: string;

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { cwd: process.cwd(), stdio: "ignore" });
  const u = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  [planner, pdl, br, anna, ben] = await Promise.all(["planer", "pdl", "br", "anna", "ben"].map((n) => u(`${n}@demo.de`)));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const types = await prisma.shiftType.findMany();
  F = types.find((t) => t.code === "F")!.id;
  S = types.find((t) => t.code === "S")!.id;
});

describe("plan workflow against Postgres", () => {
  it("only publishes after PDL and Betriebsrat approve; edits need re-approval; staff are notified", async () => {
    const plan = await getOrCreatePlan(wardId, "2031-01-01");
    await setShift(plan.id, anna, planner, "2031-01-05", F);
    await submitPlan(plan.id, planner);

    await expect(publishPlan(plan.id, planner)).rejects.toThrow();
    await reviewPlan(plan.id, pdl, "APPROVED");
    await expect(publishPlan(plan.id, planner)).rejects.toThrow();
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);

    let p = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(p.status).toBe("PUBLISHED");
    expect(await prisma.notification.count({ where: { userId: anna, type: "PLAN_PUBLISHED" } })).toBe(1);

    // edit after publish -> new version, staff still see the old snapshot
    await setShift(plan.id, anna, planner, "2031-01-05", S);
    await setShift(plan.id, ben, planner, "2031-01-06", F);
    p = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(p).toMatchObject({ status: "DRAFT", version: 2 });
    expect((p.publishedSnapshot as any[]).map((s) => s.shiftTypeId)).toEqual([F]);
    await expect(publishPlan(plan.id, planner)).rejects.toThrow();

    await submitPlan(plan.id, planner);
    await reviewPlan(plan.id, br, "APPROVED");
    await reviewPlan(plan.id, pdl, "APPROVED");
    await publishPlan(plan.id, planner);
    expect(await prisma.notification.count({ where: { userId: anna, type: "SHIFT_CHANGED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ben, type: "SHIFT_CHANGED" } })).toBe(1);
    expect((await prisma.auditLog.findMany({ where: { planId: plan.id } })).map((a) => a.action)).toContain("PUBLISHED");
  });

  it("rejection needs a comment and returns the plan to the planner", async () => {
    const plan = await getOrCreatePlan(wardId, "2031-02-01");
    await setShift(plan.id, anna, planner, "2031-02-03", F);
    await submitPlan(plan.id, planner);
    await expect(reviewPlan(plan.id, br, "REJECTED")).rejects.toThrow(/comment/);
    await reviewPlan(plan.id, br, "REJECTED", "Ruhezeit unterschritten");
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("CHANGES_REQUESTED");
  });

  it("enforces roles", async () => {
    const plan = await getOrCreatePlan(wardId, "2031-03-01");
    await expect(setShift(plan.id, anna, anna, "2031-03-01", F)).rejects.toBeInstanceOf(ForbiddenError);
    await setShift(plan.id, anna, planner, "2031-03-01", F);
    await submitPlan(plan.id, planner);
    await expect(reviewPlan(plan.id, planner, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("all five leave types can be set, published, and are kept out of the work rules", async () => {
    const leave = await prisma.shiftType.findMany({ where: { kind: { not: "WORK" } } });
    expect(leave.map((t) => t.kind).sort()).toEqual(["SICK_PAID", "SICK_UNPAID", "SPECIAL_LEAVE", "UNPAID_LEAVE", "VACATION"]);

    const plan = await getOrCreatePlan(wardId, "2031-04-01");
    for (const [i, t] of leave.entries()) await setShift(plan.id, ben, planner, `2031-04-0${i + 1}`, t.id);
    await submitPlan(plan.id, planner);
    await reviewPlan(plan.id, pdl, "APPROVED");
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);

    const p = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    const snap = p.publishedSnapshot as { shiftTypeId: string }[];
    expect(snap.map((s) => s.shiftTypeId).sort()).toEqual(leave.map((t) => t.id).sort());
    expect(await prisma.notification.count({ where: { userId: ben, type: "PLAN_PUBLISHED" } })).toBeGreaterThan(0);
  });
});
