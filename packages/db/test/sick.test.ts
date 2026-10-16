import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, toDate, ForbiddenError, SickError,
  createSickReport, extendSickReport, endSickReport, sickReportsFor, setEntitlement, getBalance, createLeave, decideLeave, anonymizeUser,
} from "../src";

let admin: string, felix: string, clara: string, planner: string, pdl: string, br: string, anna: string, ben: string, wardId: string, F: string, S: string, K: string, U: string;
const T = "2037-03-01"; // "today" for these tests

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben, admin, felix, clara] = await Promise.all(["planer", "pdl", "br", "anna", "ben", "admin", "felix", "clara"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code } })).id;
  [F, S, K, U] = await Promise.all(["F", "S", "K", "U"].map(t));
});

async function published(month: string, cells: [string, string, string][]) {
  const plan = await getOrCreatePlan(wardId, `${month}-01`);
  for (const [user, date, type] of cells) await setShift(plan.id, user, planner, date, type);
  await submitPlan(plan.id, planner); await reviewPlan(plan.id, pdl, "APPROVED"); await reviewPlan(plan.id, br, "APPROVED"); await publishPlan(plan.id, planner);
  return plan.id;
}
const snapCell = async (planId: string, userId: string, date: string) => ((await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).publishedSnapshot as { userId: string; date: string; shiftTypeId: string }[]).find((s) => s.userId === userId && s.date === date)?.shiftTypeId ?? null;
const rowCell = async (planId: string, userId: string, date: string) => (await prisma.shift.findUnique({ where: { planId_userId_date: { planId, userId, date: toDate(date) } } }))?.shiftTypeId ?? null;
const lastNote = (userId: string) => prisma.notification.findFirstOrThrow({ where: { userId, type: "SICK_REPORTED" }, orderBy: { createdAt: "desc" } });

describe("sick reports", () => {
  it("an employee's own report turns the days into sick days at once, in the published plan too, and tells planners what is uncovered", async () => {
    const plan = await published("2037-03", [[anna, "2037-03-02", F], [anna, "2037-03-03", S], [anna, "2037-03-05", F]]);
    const before = await prisma.plan.findUniqueOrThrow({ where: { id: plan } });
    const { lost } = await createSickReport(anna, { start: "2037-03-02", end: "2037-03-04", note: "eAU folgt" }, T);
    expect(lost).toEqual(["Frühdienst Mo 02.03.", "Spätdienst Di 03.03."]);
    for (const d of ["2037-03-02", "2037-03-03", "2037-03-04"]) { expect(await snapCell(plan, anna, d)).toBe(K); expect(await rowCell(plan, anna, d)).toBe(K); }
    expect(await snapCell(plan, anna, "2037-03-05")).toBe(F); // outside the report: untouched
    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan } });
    expect([after.status, after.version]).toEqual([before.status, before.version]); // a fact, not a plan change: no re-approval
    const n = await lastNote(planner);
    expect(n).toMatchObject({ title: "Krankmeldung: Anna Becker", shortNotice: true });
    expect(n.body).toContain("Ausfall: Frühdienst Mo 02.03., Spätdienst Di 03.03.");
    expect(await prisma.notification.count({ where: { userId: br, type: "SICK_REPORTED" } })).toBe(0); // health data: not to the Betriebsrat
    expect(await prisma.auditLog.count({ where: { planId: plan, action: "SICK_REPORTED" } })).toBe(1);
  });

  it("planners and PDL can report on someone's behalf (phone call); the person is told; others cannot", async () => {
    await published("2037-04", [[ben, "2037-04-06", F]]);
    await expect(createSickReport(anna, { userId: ben, start: "2037-04-06", end: "2037-04-06" }, T)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSickReport(br, { userId: ben, start: "2037-04-06", end: "2037-04-06" }, T)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSickReport(planner, { userId: pdl, start: "2037-04-06", end: "2037-04-06" }, T)).rejects.toBeInstanceOf(ForbiddenError); // only employees have rosters
    await createSickReport(pdl, { userId: ben, start: "2037-04-06", end: "2037-04-07" }, T);
    expect((await lastNote(ben)).body).toContain("hat dich für Mo 06.04.–Di 07.04. krankgemeldet");
    expect((await lastNote(planner)).shortNotice).toBe(false); // weeks ahead of "today"
  });

  it("validates ranges, back-dating and overlaps", async () => {
    await expect(createSickReport(anna, { start: "2037-03-10", end: "2037-03-09" }, T)).rejects.toThrow(/vor dem Beginn/);
    await expect(createSickReport(anna, { start: "2037-02-20", end: "2037-02-21" }, T)).rejects.toThrow(/rückwirkend/);
    await createSickReport(anna, { start: "2037-02-23", end: "2037-02-23" }, T); // 6 days back is fine
    await expect(createSickReport(anna, { start: "2037-03-10", end: "2037-04-30" }, T)).rejects.toThrow(/höchstens 42/);
    await expect(createSickReport(anna, { start: "2037-03-04", end: "2037-03-06" }, T)).rejects.toThrow(/schon eine Krankmeldung/);
    await expect(createSickReport(anna, { start: "2037-02-30", end: "2037-03-01" }, T)).rejects.toThrow(/gültige Daten/);
  });

  it("extending adds sick days and reports newly uncovered shifts", async () => {
    const report = await prisma.sickReport.findFirstOrThrow({ where: { userId: anna, start: toDate("2037-03-02") } });
    await expect(extendSickReport(anna, report.id, "2037-03-03", T)).rejects.toThrow(/nach dem bisherigen/);
    await extendSickReport(anna, report.id, "2037-03-06", T);
    const plan = (await prisma.plan.findFirstOrThrow({ where: { month: toDate("2037-03-01") } })).id;
    expect(await snapCell(plan, anna, "2037-03-05")).toBe(K);
    expect((await lastNote(planner)).body).toContain("Weiterer Ausfall: Frühdienst Do 05.03.");
  });

  it("back early: later days get their planned shifts back, unless the planner changed a day meanwhile", async () => {
    const plan = (await prisma.plan.findFirstOrThrow({ where: { month: toDate("2037-03-01") } })).id;
    const report = await prisma.sickReport.findFirstOrThrow({ where: { userId: anna, start: toDate("2037-03-02") } });
    await setShift(plan, anna, planner, "2037-03-06", S); // planner already re-planned Friday (draft edit)
    await expect(endSickReport(anna, report.id, "2037-03-10", T)).rejects.toThrow(/zwischen/);
    await endSickReport(anna, report.id, "2037-03-03", T); // healthy again from Tuesday
    expect(await snapCell(plan, anna, "2037-03-02")).toBe(K); // still sick on Monday
    expect(await snapCell(plan, anna, "2037-03-03")).toBe(S); // original Spätdienst back, published copy too
    expect(await rowCell(plan, anna, "2037-03-03")).toBe(S);
    expect(await snapCell(plan, anna, "2037-03-04")).toBeNull(); // was free
    expect(await snapCell(plan, anna, "2037-03-05")).toBe(F);
    expect(await rowCell(plan, anna, "2037-03-06")).toBe(S); // the planner's change was kept
    const r = await prisma.sickReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(r.end.toISOString().slice(0, 10)).toBe("2037-03-02");
    expect((await lastNote(planner)).title).toBe("Wieder einsatzbereit: Anna Becker");
  });

  it("a report entered by mistake can be withdrawn completely", async () => {
    const plan = await published("2037-05", [[ben, "2037-05-04", F]]);
    const { report } = await createSickReport(planner, { userId: ben, start: "2037-05-04", end: "2037-05-05" }, T);
    await endSickReport(planner, report.id, "2037-05-04", T);
    expect(await prisma.sickReport.count({ where: { id: report.id } })).toBe(0);
    expect(await snapCell(plan, ben, "2037-05-04")).toBe(F);
    expect((await lastNote(planner)).title).toBe("Krankmeldung zurückgenommen: Ben Schmidt");
  });

  it("leave days hit by sickness are not counted as leave any more (BUrlG § 9)", async () => {
    const plan = await published("2037-06", [[anna, "2037-06-08", U], [anna, "2037-06-09", U], [anna, "2037-06-10", U]]);
    await setEntitlement(planner, anna, 2037, { entitlement: 30 });
    const taken = async () => { const b = await getBalance(anna, 2037, T); return b.configured ? b.planned : -1; };
    expect(await taken()).toBe(3);
    await createSickReport(anna, { start: "2037-06-09", end: "2037-06-10" }, "2037-06-09");
    expect(await taken()).toBe(1);
    expect(await snapCell(plan, anna, "2037-06-08")).toBe(U);
  });

  it("who sees which reports", async () => {
    expect((await sickReportsFor(planner, T)).map((r) => r.name)).toEqual(expect.arrayContaining(["Anna Becker", "Ben Schmidt"]));
    const own = await sickReportsFor(anna, T);
    expect(own.every((r) => r.userId === anna)).toBe(true);
    expect((await sickReportsFor(br, T)).every((r) => r.userId === br)).toBe(true); // Betriebsrat: only own (none)
  });

  it("a month published after the report gets its published copy back too", async () => {
    const plan = await getOrCreatePlan(wardId, "2037-07-01");
    await setShift(plan.id, clara, planner, "2037-07-06", F); // still a draft
    const { report } = await createSickReport(clara, { start: "2037-07-06", end: "2037-07-07" }, "2037-07-06");
    await submitPlan(plan.id, planner); await reviewPlan(plan.id, pdl, "APPROVED"); await reviewPlan(plan.id, br, "APPROVED"); await publishPlan(plan.id, planner);
    expect(await snapCell(plan.id, clara, "2037-07-06")).toBe(K);
    await endSickReport(clara, report.id, "2037-07-06", "2037-07-06");
    expect(await snapCell(plan.id, clara, "2037-07-06")).toBe(F);
    expect(await rowCell(plan.id, clara, "2037-07-06")).toBe(F);
    expect(await snapCell(plan.id, clara, "2037-07-07")).toBeNull();
  });

  it("says which days were re-planned meanwhile and stay as they are", async () => {
    const plan = await published("2037-08", [[clara, "2037-08-03", F], [clara, "2037-08-04", F]]);
    const { report } = await createSickReport(clara, { start: "2037-08-03", end: "2037-08-04" }, "2037-08-01");
    // the planner covered Tuesday with a different entry, approved and published
    await setShift(plan, clara, planner, "2037-08-04", U);
    await submitPlan(plan, planner); await reviewPlan(plan, pdl, "APPROVED"); await reviewPlan(plan, br, "APPROVED"); await publishPlan(plan, planner);
    await endSickReport(clara, report.id, "2037-08-03", "2037-08-01");
    expect(await snapCell(plan, clara, "2037-08-03")).toBe(F);
    expect(await snapCell(plan, clara, "2037-08-04")).toBe(U);
    expect((await lastNote(planner)).body).toContain("Inzwischen umgeplant und unverändert: Di 04.08.");
  });

  it("short notice only for days in the next three days, not for back-dated ones", async () => {
    await createSickReport(clara, { start: "2037-08-10", end: "2037-08-11" }, "2037-08-14");
    expect((await lastNote(planner)).shortNotice).toBe(false);
  });

  it("reports that ended more than a week ago are closed", async () => {
    const report = await prisma.sickReport.findFirstOrThrow({ where: { userId: clara, start: toDate("2037-08-10") } });
    await expect(extendSickReport(clara, report.id, "2037-08-12", "2037-08-30")).rejects.toThrow(/abgeschlossen/);
    await expect(endSickReport(clara, report.id, "2037-08-11", "2037-08-30")).rejects.toThrow(/abgeschlossen/);
  });

  it("two reports sent at the same moment do not both go through", async () => {
    const res = await Promise.allSettled([1, 2].map(() => createSickReport(clara, { start: "2037-09-07", end: "2037-09-08" }, "2037-09-07")));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.sickReport.count({ where: { userId: clara, start: toDate("2037-09-07") } })).toBe(1);
  });

  it("approving leave leaves reported sick days alone", async () => {
    await createSickReport(clara, { start: "2037-10-05", end: "2037-10-05" }, "2037-10-05");
    const req = await createLeave(clara, { shiftTypeId: U, start: "2037-10-05", end: "2037-10-06" }, "2037-09-01");
    await decideLeave(req.id, planner, "APPROVED");
    const plan = (await prisma.plan.findFirstOrThrow({ where: { month: toDate("2037-10-01") } })).id;
    expect(await rowCell(plan, clara, "2037-10-05")).toBe(K);
    expect(await rowCell(plan, clara, "2037-10-06")).toBe(U);
  });

  it("anonymizing a person removes their sick reports", async () => {
    await createSickReport(felix, { start: "2037-03-02", end: "2037-03-02", note: "eAU folgt" }, T);
    await prisma.user.update({ where: { id: felix }, data: { active: false } });
    await anonymizeUser(admin, felix);
    expect(await prisma.sickReport.count({ where: { userId: felix } })).toBe(0);
  });
});
