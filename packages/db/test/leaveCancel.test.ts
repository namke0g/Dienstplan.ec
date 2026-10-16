import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, toDate, ForbiddenError, LeaveError,
  createLeave, decideLeave, requestLeaveCancellation, withdrawLeaveCancellation, decideLeaveCancellation, setEntitlement, getBalance, applyPendingLeave, createSickReport, endSickReport, leaveDisplayStatus,
} from "../src";

let planner: string, pdl: string, br: string, anna: string, ben: string, wardId: string, F: string, U: string;
const T = "2038-01-10"; // "today" for these tests

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben] = await Promise.all(["planer", "pdl", "br", "anna", "ben"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code } })).id;
  [F, U] = await Promise.all(["F", "U"].map(t));
  await setEntitlement(planner, anna, 2038, { entitlement: 30 });
});

async function publish(planId: string) {
  await submitPlan(planId, planner); await reviewPlan(planId, pdl, "APPROVED"); await reviewPlan(planId, br, "APPROVED"); await publishPlan(planId, planner);
}
const snapCell = async (planId: string, userId: string, date: string) => ((await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).publishedSnapshot as { userId: string; date: string; shiftTypeId: string }[]).find((s) => s.userId === userId && s.date === date)?.shiftTypeId ?? null;
const rowCell = async (planId: string, userId: string, date: string) => (await prisma.shift.findUnique({ where: { planId_userId_date: { planId, userId, date: toDate(date) } } }))?.shiftTypeId ?? null;
const lastNote = (userId: string) => prisma.notification.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
const taken = async () => { const b = await getBalance(anna, 2038, T); return b.configured ? b.planned : -1; };

describe("giving back approved leave", () => {
  let req: string, plan: string;

  it("needs a reason, own approved leave that has not started, and the planner's consent", async () => {
    req = (await createLeave(anna, { shiftTypeId: U, start: "2038-02-01", end: "2038-02-03" }, T)).id;
    await expect(requestLeaveCancellation(req, anna, "Doch nicht", T)).rejects.toThrow(/genehmigter Urlaub/); // still pending: withdraw instead
    await decideLeave(req, planner, "APPROVED");
    plan = (await prisma.plan.findFirstOrThrow({ where: { month: toDate("2038-02-01") } })).id;
    await publish(plan);
    expect(await taken()).toBe(3);

    await expect(requestLeaveCancellation(req, ben, "x", T)).rejects.toBeInstanceOf(LeaveError);
    await expect(requestLeaveCancellation(req, anna, "  ", T)).rejects.toThrow(/Grund/);
    await expect(requestLeaveCancellation(req, anna, "Reise abgesagt", "2038-02-01")).rejects.toThrow(/begonnen/);
    await requestLeaveCancellation(req, anna, "Reise abgesagt", T);
    await expect(requestLeaveCancellation(req, anna, "nochmal", T)).rejects.toThrow(/bereits beantragt/);
    expect((await lastNote(planner)).title).toBe("Rückgabe von Urlaub beantragt");
    // nothing changes until someone agrees
    expect(await snapCell(plan, anna, "2038-02-01")).toBe(U);
    expect(await taken()).toBe(3);
  });

  it("only planner, PDL or admin of the ward decide; a refusal needs a reason and keeps the leave", async () => {
    await expect(decideLeaveCancellation(req, br, "APPROVED", undefined, T)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideLeaveCancellation(req, anna, "APPROVED", undefined, T)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideLeaveCancellation(req, pdl, "REJECTED", "", T)).rejects.toThrow(/Begründung/);
    await decideLeaveCancellation(req, pdl, "REJECTED", "Vertretung ist schon geplant", T);
    expect(await lastNote(anna)).toMatchObject({ title: "Rückgabe abgelehnt", body: expect.stringContaining("Vertretung ist schon geplant") });
    const r = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req } });
    expect([r.status, r.cancelRequestedAt]).toEqual(["APPROVED", null]);
    await expect(decideLeaveCancellation(req, pdl, "APPROVED", undefined, T)).rejects.toThrow(/keine Rückgabe offen/);
  });

  it("the employee can take back the cancellation request", async () => {
    await requestLeaveCancellation(req, anna, "Reise abgesagt", T);
    await withdrawLeaveCancellation(req, anna);
    await expect(withdrawLeaveCancellation(req, anna)).rejects.toThrow(/keine offene Rückgabe/);
  });

  it("agreeing frees the days in draft and published plan and credits them back; a re-planned day stays", async () => {
    await requestLeaveCancellation(req, anna, "Reise abgesagt", T);
    await setShift(plan, anna, planner, "2038-02-03", F); // planner already changed the last day (draft, unpublished)
    const before = await prisma.plan.findUniqueOrThrow({ where: { id: plan } });
    const { freed } = await decideLeaveCancellation(req, planner, "APPROVED", undefined, T);
    expect(freed).toBe(3); // day 3: the published copy still showed the leave
    for (const d of ["2038-02-01", "2038-02-02", "2038-02-03"]) expect(await snapCell(plan, anna, d)).toBeNull();
    expect(await rowCell(plan, anna, "2038-02-01")).toBeNull();
    expect(await rowCell(plan, anna, "2038-02-03")).toBe(F); // the planner's change stays
    expect(await taken()).toBe(0);
    const r = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req } });
    expect([r.status, r.cancelledById]).toEqual(["CANCELLED", planner]);
    expect(await lastNote(anna)).toMatchObject({ title: "Rückgabe genehmigt" });
    expect(await prisma.auditLog.count({ where: { planId: plan, action: "LEAVE_CANCELLED" } })).toBe(1);
    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan } });
    expect(after.version).toBe(before.version);
    await expect(decideLeaveCancellation(req, planner, "APPROVED", undefined, T)).rejects.toThrow(/keine Rückgabe offen/);
  });

  it("months that never reached the roster are just dropped", async () => {
    const p = await getOrCreatePlan(wardId, "2038-03-01");
    await setShift(p.id, ben, planner, "2038-03-20", F);
    await submitPlan(p.id, planner); // in review: approval leaves this month pending
    const id = (await createLeave(anna, { shiftTypeId: U, start: "2038-03-02", end: "2038-03-03" }, T)).id;
    expect((await decideLeave(id, planner, "APPROVED")).pendingMonths).toEqual(["2038-03"]);
    await requestLeaveCancellation(id, anna, "Termin verschoben", T);
    expect((await decideLeaveCancellation(id, planner, "APPROVED", undefined, T)).freed).toBe(0);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).pendingMonths).toEqual([]);
    await expect(applyPendingLeave(id, "2038-03", planner)).rejects.toThrow(/nichts zu übernehmen/);
  });

  it("two deciders at once free the days only once", async () => {
    const id = (await createLeave(anna, { shiftTypeId: U, start: "2038-04-05", end: "2038-04-05" }, T)).id;
    await decideLeave(id, planner, "APPROVED");
    await requestLeaveCancellation(id, anna, "Doch nicht", T);
    const res = await Promise.allSettled([decideLeaveCancellation(id, planner, "APPROVED", undefined, T), decideLeaveCancellation(id, pdl, "APPROVED", undefined, T)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: anna, title: "Rückgabe genehmigt" } })).toBe(3); // this one, the first test's and the March one
  });

  it("days covered by a sick report come back free, not as leave, when the sickness ends", async () => {
    const id = (await createLeave(anna, { shiftTypeId: U, start: "2038-05-10", end: "2038-05-12" }, T)).id;
    await decideLeave(id, planner, "APPROVED");
    const plan = (await prisma.plan.findFirstOrThrow({ where: { month: toDate("2038-05-01") } })).id;
    const { report } = await createSickReport(anna, { start: "2038-05-08", end: "2038-05-10" }, "2038-05-08");
    await requestLeaveCancellation(id, anna, "Reha statt Urlaub", "2038-05-08");
    await decideLeaveCancellation(id, planner, "APPROVED", undefined, "2038-05-08");
    expect(await rowCell(plan, anna, "2038-05-11")).toBeNull();
    await endSickReport(anna, report.id, "2038-05-09", "2038-05-08");
    expect(await rowCell(plan, anna, "2038-05-10")).toBeNull(); // not U again
  });

  it("not while the month's plan is in review", async () => {
    const id = (await createLeave(anna, { shiftTypeId: U, start: "2038-06-08", end: "2038-06-08" }, T)).id;
    await decideLeave(id, planner, "APPROVED");
    const p = await getOrCreatePlan(wardId, "2038-06-01");
    await requestLeaveCancellation(id, anna, "Doch nicht", T);
    await submitPlan(p.id, planner);
    await expect(decideLeaveCancellation(id, planner, "APPROVED", undefined, T)).rejects.toThrow(/in Prüfung/);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });

  it("a return request lapses once the leave has begun; unknown ids give a message", async () => {
    const r = { status: "APPROVED", start: toDate("2038-06-08"), cancelRequestedAt: new Date(), cancelledAt: null };
    expect(leaveDisplayStatus(r, "2038-06-07")).toBe("RETURN_REQUESTED");
    expect(leaveDisplayStatus(r, "2038-06-08")).toBe("APPROVED");
    expect(leaveDisplayStatus({ ...r, status: "CANCELLED", cancelledAt: new Date() }, T)).toBe("RETURNED");
    await expect(decideLeaveCancellation("nope", planner, "APPROVED", undefined, T)).rejects.toBeInstanceOf(LeaveError);
  });
});
