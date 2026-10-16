import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { easterSunday, eachDay } from "@dienstplan/core";
import {
  prisma, wardHolidays, wardSettings, updateWardSettings, addWardHoliday, removeWardHoliday, getBalance, setEntitlement, createLeave,
  AdminError, ForbiddenError, LeaveError, leaveImpact,
} from "../src";

let admin: string, planner: string, anna: string, wardId: string, U: string;
const T = "2035-01-02";
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [admin, planner, anna] = await Promise.all(["admin", "planer", "anna"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  U = (await prisma.shiftType.findFirstOrThrow({ where: { code: "U" } })).id;
});

describe("ward holidays", () => {
  it("the demo ward uses NRW holidays; local extra days are added on top", async () => {
    const s = await wardSettings(wardId);
    expect(s.state).toBe("NW");
    const m = await wardHolidays(wardId, "2035-01-01", "2035-12-31");
    expect(m.get(shift(easterSunday(2035), -2))).toBe("Karfreitag");
    expect(m.get("2035-11-01")).toBe("Allerheiligen");
    expect(m.has("2035-01-06")).toBe(false); // Heilige Drei Könige is not a holiday in NRW
    await addWardHoliday(admin, { date: "2035-02-19", name: "Rosenmontag (Haustarif)" });
    expect((await wardHolidays(wardId, "2035-02-01", "2035-02-28")).get("2035-02-19")).toBe("Rosenmontag (Haustarif)");
  });

  it("leave over Easter does not deduct the holidays; requests are checked the same way", async () => {
    const goodFriday = shift(easterSunday(2035), -2); // Friday
    const monday = shift(goodFriday, -4);
    await setEntitlement(planner, anna, 2035, { entitlement: 4 });
    // Mon–Fri with Good Friday = 4 leave days: fits exactly into 4
    await createLeave(anna, { shiftTypeId: U, start: monday, end: goodFriday }, T);
    const b = await getBalance(anna, 2035, T);
    expect(b).toMatchObject({ configured: true, requested: 4, remaining: 0 });
  });

  it("without a state no holidays are taken into account", async () => {
    await updateWardSettings(admin, { state: null, leaveCountMode: "WEEKDAYS" });
    expect((await wardHolidays(wardId, "2035-01-01", "2035-12-31")).has("2035-12-25")).toBe(false);
    expect((await getBalance(anna, 2035, T))).toMatchObject({ requested: 5, remaining: -1 }); // Good Friday now counts
    await expect(createLeave(anna, { shiftTypeId: U, start: "2035-06-04", end: "2035-06-04" }, T)).rejects.toBeInstanceOf(LeaveError); // nothing left
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS" });
  });

  it("only admins change the settings; input is validated; audit entry is written", async () => {
    await expect(updateWardSettings(planner, { state: "BY", leaveCountMode: "WEEKDAYS" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateWardSettings(admin, { state: "XX", leaveCountMode: "WEEKDAYS" })).rejects.toBeInstanceOf(AdminError);
    await expect(updateWardSettings(admin, { state: "BY", leaveCountMode: "SOMETIMES" as never })).rejects.toBeInstanceOf(AdminError);
    await expect(addWardHoliday(planner, { date: "2035-08-15", name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addWardHoliday(admin, { date: "2035-02-19", name: "doppelt" })).rejects.toThrow(/schon einen Eintrag/);
    await expect(addWardHoliday(admin, { date: "kein-datum", name: "x" })).rejects.toThrow(/gültiges Datum/);
    await expect(addWardHoliday(admin, { date: "2035-08-15", name: "  " })).rejects.toThrow(/Namen/);
    await updateWardSettings(admin, { state: "BY", leaveCountMode: "ALL_DAYS" });
    expect(await wardSettings(wardId)).toMatchObject({ state: "BY", leaveCountMode: "ALL_DAYS" });
    expect(await prisma.userAudit.count({ where: { action: "WARD_SETTINGS", actorId: admin } })).toBeGreaterThanOrEqual(2);
    const extra = (await wardSettings(wardId)).extra.find((e) => e.date === "2035-02-19")!;
    await removeWardHoliday(planner, extra.id).catch(() => {}); // planners cannot remove
    expect((await wardSettings(wardId)).extra).toHaveLength(1);
    await removeWardHoliday(admin, extra.id);
    expect((await wardSettings(wardId)).extra).toHaveLength(0);
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS" });
  });

  it("bootstrap accepts a state and rejects unknown ones", async () => {
    const { bootstrap } = await import("../src");
    await expect(bootstrap({ wardName: "X", adminEmail: "x@k.de", adminName: "X", state: "XX" })).rejects.toThrow(/Unbekanntes Bundesland/);
    expect(eachDay("2035-01-01", "2035-01-02")).toHaveLength(2);
  });
});

describe("review fixes", () => {
  it("impossible dates are rejected instead of silently becoming another day", async () => {
    for (const bad of ["2035-02-30", "2035-04-31", "2035-02-29"]) await expect(addWardHoliday(admin, { date: bad, name: "x" }), bad).rejects.toThrow(/gültiges Datum/);
    expect((await wardSettings(wardId)).extra.map((e) => e.date)).not.toContain("2035-03-02");
  });

  it("two simultaneous adds of the same day give one entry and a friendly message, not an error page", async () => {
    const results = await Promise.allSettled([addWardHoliday(admin, { date: "2035-09-01", name: "A" }), addWardHoliday(admin, { date: "2035-09-01", name: "B" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(AdminError);
    expect(String(failed.reason.message)).toMatch(/schon einen Eintrag/);
    expect((await wardSettings(wardId)).extra.filter((e) => e.date === "2035-09-01")).toHaveLength(1);
  });

  it("wards can choose to count holidays as leave days (e.g. 24/7 rosters); the default follows BUrlG", async () => {
    const goodFriday = shift(easterSunday(2035), -2);
    const monday = shift(goodFriday, -4);
    expect((await leaveImpact(anna, monday, goodFriday, T))[0]).toMatchObject({ year: 2035, days: 4 });
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS", holidaysAreLeaveDays: true });
    expect((await leaveImpact(anna, monday, goodFriday, T))[0]).toMatchObject({ days: 5 });
    expect((await wardHolidays(wardId, goodFriday, goodFriday)).get(goodFriday)).toBe("Karfreitag"); // still shown in the plan
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS", holidaysAreLeaveDays: false });
    expect((await leaveImpact(anna, monday, goodFriday, T))[0]).toMatchObject({ days: 4 });
  });

  it("the setting is kept when other settings are saved without it", async () => {
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS", holidaysAreLeaveDays: true });
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS" });
    expect((await wardSettings(wardId)).holidaysAreLeaveDays).toBe(true);
    await updateWardSettings(admin, { state: "NW", leaveCountMode: "WEEKDAYS", holidaysAreLeaveDays: false });
  });
});
