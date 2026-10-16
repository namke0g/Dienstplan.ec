import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, toDate, ForbiddenError, BalanceError,
  createLeave, decideLeave, createSickReport, endSickReport, rolloverYear, setEntitlement, createSwap, acceptSwap,
  invalidatedAt, sessionStillValid, tokenIssuedAt, changePassword,
} from "../src";

let planner: string, pdl: string, br: string, anna: string, ben: string, clara: string, david: string, wardId: string, F: string, S: string, U: string;
let otherPlanner: string, otherPdl: string, otherWard: string;

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben, clara, david] = await Promise.all(["planer", "pdl", "br", "anna", "ben", "clara", "david"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code, wardId } })).id;
  [F, S, U] = await Promise.all(["F", "S", "U"].map(t));
  otherWard = (await prisma.ward.create({ data: { name: "Station 2" } })).id;
  const mk = (email: string, role: "PLANNER" | "PDL") => prisma.user.create({ data: { email, name: email, role, wardId: otherWard, passwordHash: "x" } });
  [otherPlanner, otherPdl] = (await Promise.all([mk("p2@demo.de", "PLANNER"), mk("pdl2@demo.de", "PDL")])).map((x) => x.id);
});

const snap = async (planId: string) => (await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).publishedSnapshot as { id: string; userId: string; date: string; shiftTypeId: string; sequence: number }[];
async function published(month: string, cells: [string, string, string][]) {
  const plan = await getOrCreatePlan(wardId, `${month}-01`);
  for (const [user, date, type] of cells) await setShift(plan.id, user, planner, date, type);
  await submitPlan(plan.id, planner); await reviewPlan(plan.id, pdl, "APPROVED"); await reviewPlan(plan.id, br, "APPROVED"); await publishPlan(plan.id, planner);
  return plan.id;
}

describe("robustness", () => {
  it("PDL and Betriebsrat approving at the same moment leaves the plan approved, not stuck in review", async () => {
    const plan = await getOrCreatePlan(wardId, "2040-01-01");
    await setShift(plan.id, anna, planner, "2040-01-05", F);
    await submitPlan(plan.id, planner);
    await Promise.all([reviewPlan(plan.id, pdl, "APPROVED"), reviewPlan(plan.id, br, "APPROVED")]);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("APPROVED");
  });

  it("other wards' planners and reviewers cannot touch a plan; cells must belong to the plan's month and ward", async () => {
    const plan = await getOrCreatePlan(wardId, "2040-02-01");
    await expect(setShift(plan.id, anna, otherPlanner, "2040-02-03", F)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setShift(plan.id, anna, planner, "2040-03-03", F)).rejects.toThrow(/Monat/);
    await expect(setShift(plan.id, otherPdl, planner, "2040-02-03", F)).rejects.toThrow(/anderen Station/);
    await setShift(plan.id, anna, planner, "2040-02-03", F);
    await expect(submitPlan(plan.id, otherPlanner)).rejects.toBeInstanceOf(ForbiddenError);
    await submitPlan(plan.id, planner);
    await expect(reviewPlan(plan.id, otherPdl, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("two sick reports in the same month at once both reach the published plan", async () => {
    const plan = await published("2040-03", [[anna, "2040-03-05", F], [ben, "2040-03-05", S]]);
    await Promise.all([createSickReport(anna, { start: "2040-03-05", end: "2040-03-05" }, "2040-03-05"), createSickReport(ben, { start: "2040-03-05", end: "2040-03-05" }, "2040-03-05")]);
    const K = (await prisma.shiftType.findFirstOrThrow({ where: { wardId, kind: "SICK" }, orderBy: [{ paid: "desc" }, { code: "asc" }] })).id;
    const s = await snap(plan);
    expect([anna, ben].map((u) => s.find((x) => x.userId === u && x.date === "2040-03-05")?.shiftTypeId)).toEqual([K, K]);
  });

  it("an approve and a reject of the same leave request at once: only one decision counts", async () => {
    const id = (await createLeave(clara, { shiftTypeId: U, start: "2040-04-02", end: "2040-04-03" }, "2040-01-01")).id;
    const res = await Promise.allSettled([decideLeave(id, planner, "APPROVED"), decideLeave(id, pdl, "REJECTED", "Engpass")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const r = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    const plan = await prisma.plan.findFirst({ where: { wardId, month: toDate("2040-04-01") } });
    const inRoster = plan ? await prisma.shift.count({ where: { planId: plan.id, userId: clara, shiftTypeId: U } }) : 0;
    expect(inRoster).toBe(r.status === "APPROVED" ? 2 : 0);
  });

  it("a double tap does not create two overlapping leave requests", async () => {
    const res = await Promise.allSettled([1, 2].map(() => createLeave(david, { shiftTypeId: U, start: "2040-05-04", end: "2040-05-05" }, "2040-01-01")));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("leave approved during a sickness takes those days back when the sickness ends early", async () => {
    const plan = await getOrCreatePlan(wardId, "2040-06-01");
    for (const d of ["2040-06-04", "2040-06-05", "2040-06-06"]) await setShift(plan.id, anna, planner, d, F);
    const { report } = await createSickReport(anna, { start: "2040-06-04", end: "2040-06-06" }, "2040-06-04");
    const id = (await createLeave(anna, { shiftTypeId: U, start: "2040-06-05", end: "2040-06-06" }, "2040-01-01")).id;
    await decideLeave(id, planner, "APPROVED");
    await endSickReport(anna, report.id, "2040-06-05", "2040-06-04");
    const row = async (d: string) => (await prisma.shift.findUnique({ where: { planId_userId_date: { planId: plan.id, userId: anna, date: toDate(d) } } }))?.shiftTypeId;
    expect([await row("2040-06-05"), await row("2040-06-06")]).toEqual([U, U]); // the approved leave, not the early shifts
  });

  it("two colleagues taking the same open offer at once: only one gets it", async () => {
    await published("2040-07", [[anna, "2040-07-10", F]]);
    const offer = await createSwap(anna, { date: "2040-07-10" }, "2040-07-01");
    const res = await Promise.allSettled([acceptSwap(offer.id, ben), acceptSwap(offer.id, clara)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("republishing never lowers a calendar event's sequence", async () => {
    const plan = await published("2040-08", [[anna, "2040-08-10", F]]);
    const { report } = await createSickReport(anna, { start: "2040-08-10", end: "2040-08-10" }, "2040-08-10");
    await setShift(plan, anna, planner, "2040-08-10", S); // planner re-plans the draft while sick
    await endSickReport(anna, report.id, "2040-08-10", "2040-08-10"); // published copy goes back to F
    const before = (await snap(plan)).find((x) => x.userId === anna && x.date === "2040-08-10")!;
    await submitPlan(plan, planner); await reviewPlan(plan, pdl, "APPROVED"); await reviewPlan(plan, br, "APPROVED"); await publishPlan(plan, planner);
    const after = (await snap(plan)).find((x) => x.userId === anna && x.date === "2040-08-10")!;
    expect(after.shiftTypeId).toBe(S);
    expect(after.id === before.id ? after.sequence > before.sequence : true).toBe(true);
  });

  it("year-end rollover waits until open requests for that year are decided", async () => {
    await setEntitlement(planner, ben, 2041, { entitlement: 30 });
    const id = (await createLeave(ben, { shiftTypeId: U, start: "2041-12-03", end: "2041-12-04" }, "2041-01-01")).id;
    await expect(rolloverYear(planner, 2041)).rejects.toBeInstanceOf(BalanceError);
    await decideLeave(id, planner, "REJECTED", "Engpass");
    await rolloverYear(planner, 2041);
    expect((await prisma.leaveEntitlement.findUniqueOrThrow({ where: { userId_year: { userId: ben, year: 2042 } } })).carryOver).toBe(30);
  });

  it("a second session end within the same second also ends a token issued right after the first", () => {
    const first = new Date(100_100); // reset at 100.1 s
    const iat = tokenIssuedAt(first, 100_400); // attacker logs in at 100.4 s
    expect(sessionStillValid(first, iat)).toBe(true);
    const second = invalidatedAt(first, new Date(100_800)); // second reset at 100.8 s
    expect(sessionStillValid(second, iat)).toBe(false);
    expect(sessionStillValid(second, tokenIssuedAt(second, 100_900))).toBe(true); // a fresh login still works
  });

  it("changing the password stops pushes to all devices, phones included", async () => {
    await prisma.deviceToken.createMany({ data: [{ userId: david, platform: "IOS", token: "ExponentPushToken[lost-phone]" }, { userId: david, platform: "WEB", token: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" }] });
    await changePassword(david, "demo1234", "ein-ganz-neues-Passwort-42");
    expect(await prisma.deviceToken.count({ where: { userId: david } })).toBe(0);
  });
});
