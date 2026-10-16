import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, ForbiddenError, WishError,
  setWish, deleteWish, myWishes, wardWishes, setPreference, getPreference, updateWardSettings, anonymizeUser,
} from "../src";

let admin: string, planner: string, pdl: string, br: string, anna: string, ben: string, felix: string, wardId: string, F: string, N: string, U: string;
const T = "2039-01-10";

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [admin, planner, pdl, br, anna, ben, felix] = await Promise.all(["admin", "planer", "pdl", "br", "anna", "ben", "felix"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code } })).id;
  [F, N, U] = await Promise.all(["F", "N", "U"].map(t));
});

describe("shift wishes", () => {
  it("employees wish days off or shifts for future months; one wish per day, replaced on change", async () => {
    await setWish(anna, { date: "2039-02-03", kind: "FREE", note: "Geburtstag" }, T);
    await setWish(anna, { date: "2039-02-04", kind: "SHIFT", shiftTypeId: F }, T);
    await setWish(anna, { date: "2039-02-04", kind: "SHIFT", shiftTypeId: N }, T); // replaces
    const mine = await myWishes(anna, "2039-02", T);
    expect(mine.wishes.map((w) => [w.date, w.kind, w.shiftType?.code ?? null])).toEqual([["2039-02-03", "FREE", null], ["2039-02-04", "SHIFT", "N"]]);
    expect([mine.closed, mine.freeLimit, mine.freeLeft]).toEqual([null, 4, 3]);
  });

  it("validates: future months only, work shifts only, employees only", async () => {
    await expect(setWish(anna, { date: "2039-01-20", kind: "FREE" }, T)).rejects.toThrow(/keine Wünsche mehr/);
    await expect(setWish(anna, { date: "2039-02-05", kind: "SHIFT", shiftTypeId: U }, T)).rejects.toThrow(/Dienst auswählen/);
    await expect(setWish(anna, { date: "2039-02-30", kind: "FREE" }, T)).rejects.toThrow(/gültiges Datum/);
    await expect(setWish(planner, { date: "2039-02-05", kind: "FREE" }, T)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Wunschfrei is limited per month (ward setting), also under double taps", async () => {
    await updateWardSettings(admin, { state: null, leaveCountMode: "WEEKDAYS", freeWishesPerMonth: 2 });
    const res = await Promise.allSettled(["2039-02-10", "2039-02-11"].map((date) => setWish(anna, { date, kind: "FREE" }, T)));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(setWish(anna, { date: "2039-02-12", kind: "FREE" }, T)).rejects.toThrow(/höchstens 2 Wunschfrei/);
    await setWish(anna, { date: "2039-02-03", kind: "FREE", note: "Geburtstag!" }, T); // changing an existing one is fine
    await expect(updateWardSettings(admin, { state: null, leaveCountMode: "WEEKDAYS", freeWishesPerMonth: 99 })).rejects.toThrow(/0 bis 15/);
    await updateWardSettings(admin, { state: null, leaveCountMode: "WEEKDAYS", freeWishesPerMonth: 4 });
  });

  it("only the planning side sees everyone's wishes", async () => {
    await setWish(ben, { date: "2039-02-03", kind: "FREE" }, T);
    const w = await wardWishes(planner, "2039-02");
    expect(new Set(w.wishes.map((x) => x.userId))).toEqual(new Set([anna, ben]));
    expect(w.wishes.find((x) => x.userId === anna && x.date === "2039-02-03")?.note).toBe("Geburtstag!");
    for (const who of [anna, pdl, br]) await expect(wardWishes(who, "2039-02")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the window closes when the plan goes into review or was published", async () => {
    const plan = await getOrCreatePlan(wardId, "2039-02-01");
    await setShift(plan.id, ben, planner, "2039-02-06", F);
    await submitPlan(plan.id, planner);
    await expect(setWish(anna, { date: "2039-02-20", kind: "FREE" }, T)).rejects.toThrow(/Genehmigung/);
    const own = (await myWishes(anna, "2039-02", T)).wishes[0]!;
    await expect(deleteWish(anna, own.id, T)).rejects.toThrow(/Genehmigung/);
    await reviewPlan(plan.id, pdl, "APPROVED"); await reviewPlan(plan.id, br, "APPROVED"); await publishPlan(plan.id, planner);
    expect((await myWishes(anna, "2039-02", T)).closed).toMatch(/veröffentlicht/);
  });

  it("deleting: own wishes while the window is open", async () => {
    const w = await setWish(anna, { date: "2039-03-02", kind: "FREE" }, T);
    await expect(deleteWish(ben, w.id, T)).rejects.toThrow(/nicht gefunden/);
    await deleteWish(anna, w.id, T);
    expect((await myWishes(anna, "2039-03", T)).wishes).toHaveLength(0);
  });

  it("standing preferences: work shifts only, not both preferred and avoided", async () => {
    await setPreference(anna, { prefer: [F, U], avoid: [N], note: "Kinderbetreuung ab 15 Uhr" });
    expect(await getPreference(anna)).toEqual({ prefer: [F], avoid: [N], note: "Kinderbetreuung ab 15 Uhr" });
    await expect(setPreference(anna, { prefer: [F], avoid: [F] })).rejects.toBeInstanceOf(WishError);
    expect((await wardWishes(planner, "2039-02")).preferences).toEqual([{ userId: anna, prefer: [F], avoid: [N], note: "Kinderbetreuung ab 15 Uhr" }]);
  });

  it("anonymizing removes wishes and preferences", async () => {
    await setWish(felix, { date: "2039-03-05", kind: "FREE", note: "privat" }, T);
    await setPreference(felix, { prefer: [], avoid: [N] });
    await prisma.user.update({ where: { id: felix }, data: { active: false } });
    await anonymizeUser(admin, felix);
    expect(await prisma.shiftWish.count({ where: { userId: felix } })).toBe(0);
    expect(await prisma.shiftPreference.count({ where: { userId: felix } })).toBe(0);
  });

  it("short months: wishes early next month do not count against February (no day-31 overflow)", async () => {
    for (const date of ["2039-05-01", "2039-05-02"]) await setWish(ben, { date, kind: "FREE" }, T);
    const apr = await myWishes(ben, "2039-04", T);
    expect([apr.wishes.length, apr.freeLeft]).toEqual([0, 4]);
    expect((await wardWishes(planner, "2039-04")).wishes.filter((w) => w.userId === ben)).toHaveLength(0);
  });

  it("stays closed while a submitted plan is sent back for changes", async () => {
    const plan = await getOrCreatePlan(wardId, "2039-06-01");
    await setShift(plan.id, ben, planner, "2039-06-06", F);
    await submitPlan(plan.id, planner); await reviewPlan(plan.id, pdl, "REJECTED", "Bitte Wochenende prüfen");
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("CHANGES_REQUESTED");
    await expect(setWish(ben, { date: "2039-06-20", kind: "FREE" }, T)).rejects.toThrow(/Genehmigung/);
  });

  it("wishes of people who are no longer employees (e.g. promoted to planner) are left out", async () => {
    await setWish(ben, { date: "2039-05-03", kind: "FREE" }, T);
    await prisma.user.update({ where: { id: ben }, data: { role: "PLANNER" } });
    expect((await wardWishes(planner, "2039-05")).wishes.some((w) => w.userId === ben)).toBe(false);
    await prisma.user.update({ where: { id: ben }, data: { role: "EMPLOYEE" } });
  });
});
