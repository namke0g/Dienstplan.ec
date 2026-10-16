import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getBalance, setEntitlement, setDefaultEntitlements, rolloverYear, wardBalances, createLeave, decideLeave, cancelLeave,
  getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, LeaveError, BalanceError, ForbiddenError,
} from "../src";

let wardId: string, planner: string, pdl: string, br: string, anna: string, ben: string, clara: string;
let U: string, UU: string, SU: string, F: string;
const T = "2035-01-02";

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben, clara] = await Promise.all(["planer", "pdl", "br", "anna", "ben", "clara"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code } })).id;
  [U, UU, SU, F] = await Promise.all(["U", "UU", "SU", "F"].map(t));
});

describe("leave balance", () => {
  it("is 'not configured' without an entitlement, and then requests are not limited", async () => {
    expect(await getBalance(anna, 2036)).toMatchObject({ configured: false });
    await createLeave(anna, { shiftTypeId: U, start: "2036-03-02", end: "2036-04-30" }, "2036-01-02"); // 40+ days, no entitlement entered
  });

  it("only paid Urlaub consumes days; unpaid leave and Sonderurlaub do not", async () => {
    expect((await prisma.shiftType.findMany({ where: { consumesLeave: true } })).map((t) => t.code)).toEqual(["U"]);
    await setEntitlement(planner, ben, 2035, { entitlement: 30 });
    await createLeave(ben, { shiftTypeId: UU, start: "2035-03-05", end: "2035-03-09" }, T);
    await createLeave(ben, { shiftTypeId: SU, start: "2035-04-02", end: "2035-04-06", note: "Hochzeit" }, T);
    expect(await getBalance(ben, 2035, T)).toMatchObject({ requested: 0, remaining: 30 });
  });

  it("counts open requests, approved leave in the roster and held months; weekends are not deducted", async () => {
    await setEntitlement(planner, anna, 2035, { entitlement: 10 });
    const week = await createLeave(anna, { shiftTypeId: U, start: "2035-03-05", end: "2035-03-11" }, T); // Mon–Sun = 5 counted days
    expect(await getBalance(anna, 2035, T)).toMatchObject({ requested: 5, remaining: 5, taken: 0, planned: 0 });

    await decideLeave(week.id, planner, "APPROVED"); // draft plan => written into the roster
    expect(await getBalance(anna, 2035, T)).toMatchObject({ requested: 0, planned: 5, remaining: 5 });
    expect(await getBalance(anna, 2035, "2035-06-01")).toMatchObject({ taken: 5, planned: 0 }); // same days, later "today"

    // a month whose plan is published: approval is held, still counted
    const plan = await getOrCreatePlan(wardId, "2035-06-01");
    await setShift(plan.id, ben, planner, "2035-06-01", F);
    await submitPlan(plan.id, planner); await reviewPlan(plan.id, pdl, "APPROVED"); await reviewPlan(plan.id, br, "APPROVED"); await publishPlan(plan.id, planner);
    const held = await createLeave(anna, { shiftTypeId: U, start: "2035-06-04", end: "2035-06-05" }, T);
    await decideLeave(held.id, planner, "APPROVED");
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: held.id } })).pendingMonths).toEqual(["2035-06"]);
    expect(await getBalance(anna, 2035, T)).toMatchObject({ planned: 5, approvedHeld: 2, remaining: 3 });
  });

  it("refuses requests that exceed the remaining days, with the numbers in the message", async () => {
    // anna has 3 left from the previous test
    await expect(createLeave(anna, { shiftTypeId: U, start: "2035-07-02", end: "2035-07-06" }, T)).rejects.toThrow(/Nicht genug Resturlaub 2035: 3 Tag\(e\) verfügbar, 5 beantragt/);
    await expect(createLeave(anna, { shiftTypeId: U, start: "2035-07-02", end: "2035-07-06" }, T)).rejects.toBeInstanceOf(LeaveError);
    const ok = await createLeave(anna, { shiftTypeId: U, start: "2035-07-02", end: "2035-07-04" }, T); // exactly 3
    expect((await getBalance(anna, 2035, T)).remaining).toBe(0);
    await cancelLeave(ok.id, anna); // cancelling frees the days
    expect((await getBalance(anna, 2035, T)).remaining).toBe(3);
    // weekend-only requests deduct nothing
    await createLeave(anna, { shiftTypeId: U, start: "2035-07-07", end: "2035-07-08" }, T);
  });

  it("checks each year separately for requests across New Year", async () => {
    await setEntitlement(planner, clara, 2035, { entitlement: 30 });
    await setEntitlement(planner, clara, 2036, { entitlement: 1 });
    await expect(createLeave(clara, { shiftTypeId: U, start: "2035-12-31", end: "2036-01-03" }, T)).rejects.toThrow(/2036: 1 Tag\(e\) verfügbar, 2 beantragt/); // Jan 1–3 2036 = Tue–Thu, but 1 Jan is Neujahr (holiday, not deducted)
  });

  it("carry-over: counts while valid, lapses unused after its expiry", async () => {
    await setEntitlement(planner, ben, 2037, { entitlement: 30, carryOver: 4, carryOverExpires: "2037-03-31" });
    expect(await getBalance(ben, 2037, "2037-02-01")).toMatchObject({ total: 34, expiring: 4, forfeited: 0, remaining: 34 });
    expect(await getBalance(ben, 2037, "2037-05-01")).toMatchObject({ total: 30, forfeited: 4, expiring: 0, remaining: 30 });
  });

  it("management: validation, roles, defaults do not overwrite, rollover carries the rest into the new year", async () => {
    await expect(setEntitlement(planner, anna, 2035, { entitlement: 30.3 })).rejects.toBeInstanceOf(BalanceError);
    await expect(setEntitlement(planner, anna, 2035, { entitlement: -1 })).rejects.toBeInstanceOf(BalanceError);
    await expect(setEntitlement(planner, planner, 2035, { entitlement: 30 })).rejects.toBeInstanceOf(BalanceError); // not an employee
    await expect(setEntitlement(pdl, anna, 2035, { entitlement: 30 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setEntitlement(anna, anna, 2035, { entitlement: 99 })).rejects.toBeInstanceOf(ForbiddenError); // no self-service
    await setEntitlement(planner, ben, 2038, { entitlement: 28.5, adjustment: -0.5, note: "Teilzeit" });
    expect(await getBalance(ben, 2038, T)).toMatchObject({ total: 28, remaining: 28 });

    const r = await setDefaultEntitlements(planner, 2038, 30);
    expect(r.created).toBeGreaterThanOrEqual(5);
    expect((await prisma.leaveEntitlement.findUniqueOrThrow({ where: { userId_year: { userId: ben, year: 2038 } } })).entitlement).toBe(28.5); // kept
    expect((await setDefaultEntitlements(planner, 2038, 30)).created).toBe(0);

    // anna: 2035 has 3 days left => 2036 gets carry-over 3 expiring 2036-03-31
    await prisma.leaveEntitlement.deleteMany({ where: { userId: anna, year: 2036 } });
    const roll = await rolloverYear(planner, 2035, undefined, T);
    expect(roll.created).toBeGreaterThanOrEqual(1);
    const a36 = await prisma.leaveEntitlement.findUniqueOrThrow({ where: { userId_year: { userId: anna, year: 2036 } } });
    expect(a36).toMatchObject({ entitlement: 10, carryOver: 3 });
    expect(a36.carryOverExpires?.toISOString().slice(0, 10)).toBe("2036-03-31");
    expect((await prisma.leaveEntitlement.findUniqueOrThrow({ where: { userId_year: { userId: clara, year: 2036 } } })).entitlement).toBe(1); // existing entry untouched
    expect((await rolloverYear(planner, 2035, undefined, T)).created).toBe(0);

    const overview = await wardBalances(planner, 2035, T);
    expect(overview.find((o) => o.user.id === anna)?.balance).toMatchObject({ configured: true, remaining: 3 });
  });
});
