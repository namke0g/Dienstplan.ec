import { describe, expect, it } from "vitest";
import { eachDay, isYmd, monthsBetween, rangesOverlap, validateLeaveRange } from "../src";

describe("leave helpers", () => {
  it("lists days inclusive, across month and leap day", () => {
    expect(eachDay("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(eachDay("2026-11-05", "2026-11-05")).toEqual(["2026-11-05"]);
  });
  it("finds the months in a range", () => {
    expect(monthsBetween("2026-12-29", "2027-01-03")).toEqual(["2026-12", "2027-01"]);
  });
  it("detects overlaps (touching ends overlap)", () => {
    expect(rangesOverlap({ start: "2026-11-01", end: "2026-11-05" }, { start: "2026-11-05", end: "2026-11-08" })).toBe(true);
    expect(rangesOverlap({ start: "2026-11-01", end: "2026-11-04" }, { start: "2026-11-05", end: "2026-11-08" })).toBe(false);
  });
  it("validates ranges", () => {
    expect(isYmd("2026-02-30")).toBe(false);
    expect(validateLeaveRange("2026-11-05", "2026-11-01", "2026-10-16")).toMatch(/vor dem Beginn/);
    expect(validateLeaveRange("2026-09-01", "2026-09-05", "2026-10-16")).toMatch(/Vergangenheit/);
    expect(validateLeaveRange("2026-10-10", "2026-10-20", "2026-10-16")).toBeNull(); // already running is fine
    expect(validateLeaveRange("2026-11-01", "2027-02-01", "2026-10-16")).toMatch(/höchstens/);
    expect(validateLeaveRange("nope", "2026-11-01", "2026-10-16")).toMatch(/gültige/);
  });
});
