import { describe, expect, it } from "vitest";
import { computeBalance, countDays, countsAsDay, eachDay, type Entitlement } from "../src";

const ent = (o: Partial<Entitlement> = {}): Entitlement => ({ year: 2026, entitlement: 30, carryOver: 0, carryOverExpires: null, adjustment: 0, ...o });
const base = { today: "2026-06-15", mode: "WEEKDAYS" as const, inRoster: [] as string[], requested: [] as string[], held: [] as string[] };

describe("counting days", () => {
  it("counts Mon–Fri by default, every day in ALL_DAYS mode", () => {
    const week = eachDay("2026-10-19", "2026-10-25"); // Mon..Sun
    expect(countDays(week, "WEEKDAYS")).toBe(5);
    expect(countDays(week, "ALL_DAYS")).toBe(7);
    expect(countsAsDay("2026-10-24", "WEEKDAYS")).toBe(false); // Saturday
  });
  it("does not double count duplicate dates", () => {
    expect(countDays(["2026-10-19", "2026-10-19"], "WEEKDAYS")).toBe(1);
  });
});

describe("balance", () => {
  it("splits taken / planned / held / requested and subtracts from the total", () => {
    const b = computeBalance({
      ...base, ent: ent(),
      inRoster: ["2026-03-02", "2026-03-03", "2026-07-06"], // 2 taken, 1 planned
      held: ["2026-08-03", "2026-08-04"], requested: ["2026-09-07"],
    });
    expect(b).toMatchObject({ total: 30, taken: 2, planned: 1, approvedHeld: 2, requested: 1, remaining: 24 });
  });

  it("ignores weekends in WEEKDAYS mode and other years", () => {
    const b = computeBalance({ ...base, ent: ent(), inRoster: ["2026-03-07", "2026-03-08", "2025-12-30", "2027-01-04"] });
    expect(b.taken + b.planned).toBe(0);
    expect(computeBalance({ ...base, mode: "ALL_DAYS", ent: ent(), inRoster: ["2026-03-07", "2026-03-08"] }).taken).toBe(2);
  });

  it("adds carry-over and adjustment to the total", () => {
    expect(computeBalance({ ...base, ent: ent({ carryOver: 4, adjustment: -1.5 }) }).total).toBe(32.5);
  });

  it("carry-over lapses after its expiry date if unused, but used days protect it", () => {
    const e = ent({ carryOver: 5, carryOverExpires: "2026-03-31" });
    const unused = computeBalance({ ...base, ent: e });
    expect(unused).toMatchObject({ forfeited: 5, total: 30, remaining: 30, expiring: 0 });
    const partly = computeBalance({ ...base, ent: e, inRoster: ["2026-03-02", "2026-03-03"] });
    expect(partly).toMatchObject({ forfeited: 3, total: 32, remaining: 30 });
    const used = computeBalance({ ...base, ent: e, inRoster: eachDay("2026-03-02", "2026-03-06") });
    expect(used).toMatchObject({ forfeited: 0, total: 35, taken: 5, remaining: 30 });
  });

  it("warns about carry-over that will lapse soon; leave booked before the expiry counts", () => {
    const e = ent({ carryOver: 5, carryOverExpires: "2026-09-30" });
    expect(computeBalance({ ...base, ent: e })).toMatchObject({ expiring: 5, forfeited: 0, total: 35 });
    expect(computeBalance({ ...base, ent: e, requested: ["2026-08-03", "2026-08-04"] }).expiring).toBe(3);
    expect(computeBalance({ ...base, ent: e, inRoster: ["2026-10-05"] }).expiring).toBe(5); // after expiry: does not help
  });

  it("can go negative when over-booked", () => {
    expect(computeBalance({ ...base, ent: ent({ entitlement: 1 }), requested: eachDay("2026-07-06", "2026-07-10") }).remaining).toBe(-4);
  });

  it("supports half days in the entitlement", () => {
    expect(computeBalance({ ...base, ent: ent({ entitlement: 28.5 }), requested: ["2026-07-06"] }).remaining).toBe(27.5);
  });
});

describe("public holidays", () => {
  const easterWeek = eachDay("2026-03-30", "2026-04-10"); // Mon 30.3. – Fri 10.4.2026, contains Karfreitag 3.4. and Ostermontag 6.4.
  const by = new Set(["2026-04-03", "2026-04-06"]);
  it("are not deducted from leave, in either counting mode", () => {
    expect(countDays(easterWeek, "WEEKDAYS")).toBe(10);
    expect(countDays(easterWeek, "WEEKDAYS", by)).toBe(8);
    expect(countDays(easterWeek, "ALL_DAYS", by)).toBe(10); // 12 calendar days minus 2 holidays
  });
  it("flow into the balance for roster days and requests", () => {
    const b = computeBalance({ ...base, ent: ent(), today: "2026-01-02", inRoster: easterWeek.slice(0, 6), requested: easterWeek.slice(6), holidays: by });
    expect(b).toMatchObject({ planned: 4, requested: 4, remaining: 22 }); // without holidays: 5 + 5 => 20
  });
});
