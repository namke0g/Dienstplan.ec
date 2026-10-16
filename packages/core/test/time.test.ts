import { describe, expect, it } from "vitest";
import { addDaysYmd, localToday } from "../src";

describe("local date of the ward", () => {
  it("00:30 in Germany is already the next day there, while UTC still has the previous day", () => {
    expect(localToday(new Date("2026-10-16T22:30:00Z"), "Europe/Berlin")).toBe("2026-10-17"); // summer time, UTC+2
    expect(localToday(new Date("2026-12-16T23:30:00Z"), "Europe/Berlin")).toBe("2026-12-17"); // winter time, UTC+1
    expect(localToday(new Date("2026-12-16T22:30:00Z"), "Europe/Berlin")).toBe("2026-12-16");
    expect(localToday(new Date("2026-10-16T22:30:00Z"), "UTC")).toBe("2026-10-16");
  });
  it("adds days across month and year ends", () => {
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2028-03-01", -1)).toBe("2028-02-29");
  });
});
