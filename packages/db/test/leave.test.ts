import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, createLeave, cancelLeave, decideLeave, applyPendingLeave, leaveContext,
  ForbiddenError, LeaveError, toDate,
} from "../src";

let wardId: string, planner: string, pdl: string, br: string, anna: string, ben: string;
let U: string, UU: string, SU: string, K: string, F: string;
const T = "2026-01-01"; // fixed "today" so tests do not depend on the calendar

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben] = await Promise.all(["planer", "pdl", "br", "anna", "ben"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code } })).id;
  [U, UU, SU, K, F] = await Promise.all(["U", "UU", "SU", "K", "F"].map(t));
});

const cell = (planId: string, userId: string, date: string) => prisma.shift.findUnique({ where: { planId_userId_date: { planId, userId, date: toDate(date) } } });

describe("leave requests", () => {
  it("validates requests: type, dates, reason for Sonderurlaub, overlaps", async () => {
    await expect(createLeave(anna, { shiftTypeId: K, start: "2033-03-01", end: "2033-03-02" }, T)).rejects.toThrow(/nicht beantragt/);
    await expect(createLeave(anna, { shiftTypeId: F, start: "2033-03-01", end: "2033-03-02" }, T)).rejects.toThrow(/nicht beantragt/);
    await expect(createLeave(anna, { shiftTypeId: U, start: "2033-03-05", end: "2033-03-01" }, T)).rejects.toThrow(/vor dem Beginn/);
    await expect(createLeave(anna, { shiftTypeId: SU, start: "2033-03-01", end: "2033-03-02" }, T)).rejects.toThrow(/Grund/);
    await createLeave(anna, { shiftTypeId: SU, start: "2033-03-01", end: "2033-03-02", note: "Umzug" }, T);
    await expect(createLeave(anna, { shiftTypeId: U, start: "2033-03-02", end: "2033-03-04" }, T)).rejects.toThrow(/überschneidet/);
    // other people may overlap
    await createLeave(ben, { shiftTypeId: U, start: "2033-03-02", end: "2033-03-04" }, T);
  });

  it("approval writes the absence into a draft plan, replacing planned shifts, and notifies", async () => {
    const plan = await getOrCreatePlan(wardId, "2033-04-01");
    await setShift(plan.id, anna, planner, "2033-04-12", F);
    const req = await createLeave(anna, { shiftTypeId: U, start: "2033-04-11", end: "2033-04-13" }, T);
    expect((await leaveContext(req.id)).clashingShifts).toBe(1);
    const r = await decideLeave(req.id, pdl, "APPROVED"); // PDL may decide
    expect(r).toEqual({ pendingMonths: [], replaced: 1 });
    for (const d of ["2033-04-11", "2033-04-12", "2033-04-13"]) expect((await cell(plan.id, anna, d))?.shiftTypeId).toBe(U);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: anna, type: "LEAVE_DECIDED" }, orderBy: { createdAt: "desc" } })).title).toBe("Antrag genehmigt");
    await expect(decideLeave(req.id, planner, "REJECTED", "zu spät")).rejects.toBeInstanceOf(LeaveError); // already decided
  });

  it("creates the plan when none exists and spans months", async () => {
    const req = await createLeave(anna, { shiftTypeId: UU, start: "2033-05-30", end: "2033-06-02" }, T);
    await decideLeave(req.id, planner, "APPROVED");
    const may = await prisma.plan.findFirstOrThrow({ where: { month: toDate("2033-05-01") } });
    const jun = await prisma.plan.findFirstOrThrow({ where: { month: toDate("2033-06-01") } });
    expect(await prisma.shift.count({ where: { planId: may.id, userId: anna, shiftTypeId: UU } })).toBe(2);
    expect(await prisma.shift.count({ where: { planId: jun.id, userId: anna, shiftTypeId: UU } })).toBe(2);
  });

  it("does not touch plans in review or published; planner applies those months explicitly", async () => {
    const plan = await getOrCreatePlan(wardId, "2033-07-01");
    await setShift(plan.id, ben, planner, "2033-07-01", F);
    await submitPlan(plan.id, planner);
    const req = await createLeave(anna, { shiftTypeId: U, start: "2033-07-04", end: "2033-07-05" }, T);
    const r = await decideLeave(req.id, planner, "APPROVED");
    expect(r.pendingMonths).toEqual(["2033-07"]);
    expect(await cell(plan.id, anna, "2033-07-04")).toBeNull();
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("IN_REVIEW");

    await expect(applyPendingLeave(req.id, "2033-07", planner)).rejects.toThrow(/in Prüfung/);
    await reviewPlan(plan.id, pdl, "APPROVED");
    await reviewPlan(plan.id, br, "APPROVED");
    await publishPlan(plan.id, planner);
    await expect(applyPendingLeave(req.id, "2033-07", pdl)).rejects.toBeInstanceOf(ForbiddenError); // only planners edit rosters

    await applyPendingLeave(req.id, "2033-07", planner);
    expect((await cell(plan.id, anna, "2033-07-04"))?.shiftTypeId).toBe(U);
    const p = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(p).toMatchObject({ status: "DRAFT", version: 2 }); // same rule as any edit of a published plan
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } })).pendingMonths).toEqual([]);
    await expect(applyPendingLeave(req.id, "2033-07", planner)).rejects.toThrow(/nichts zu übernehmen/);
  });

  it("rejection needs a reason and leaves the roster alone; employees can cancel only their own open requests", async () => {
    const req = await createLeave(anna, { shiftTypeId: U, start: "2033-08-01", end: "2033-08-03" }, T);
    await expect(decideLeave(req.id, planner, "REJECTED")).rejects.toThrow(/Begründung/);
    await expect(decideLeave(req.id, anna, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideLeave(req.id, br, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError); // Betriebsrat does not decide individual leave
    await decideLeave(req.id, planner, "REJECTED", "Personalengpass");
    expect(await prisma.plan.count({ where: { month: toDate("2033-08-01") } })).toBe(0);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: anna, type: "LEAVE_DECIDED" }, orderBy: { createdAt: "desc" } })).body).toContain("Personalengpass");

    const mine = await createLeave(anna, { shiftTypeId: U, start: "2033-09-01", end: "2033-09-02" }, T);
    await expect(cancelLeave(mine.id, ben)).rejects.toBeInstanceOf(LeaveError);
    await cancelLeave(mine.id, anna);
    // cancelled requests free the dates again
    await createLeave(anna, { shiftTypeId: U, start: "2033-09-01", end: "2033-09-02" }, T);
  });

  it("notifies planners and PDL (not the Betriebsrat) about new requests", async () => {
    const n = await prisma.notification.findMany({ where: { type: "LEAVE_REQUESTED" } });
    const ids = new Set(n.map((x) => x.userId));
    expect(ids.has(planner) && ids.has(pdl)).toBe(true);
    expect(ids.has(br)).toBe(false);
  });
});
