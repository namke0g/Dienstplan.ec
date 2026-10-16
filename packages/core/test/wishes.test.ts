import { describe, expect, it } from "vitest";
import { wishState, wishSummary, type Wish } from "../src";

const kinds: Record<string, string> = { F: "WORK", N: "WORK", U: "VACATION", K: "SICK" };
const kindOf = (id: string) => kinds[id];
const free: Wish = { userId: "a", date: "2030-01-02", kind: "FREE", shiftTypeId: null };
const early: Wish = { userId: "a", date: "2030-01-03", kind: "SHIFT", shiftTypeId: "F" };

describe("wishes", () => {
  it("Wunschfrei: met by a free day or any absence, missed by work", () => {
    expect(wishState(free, null, kindOf)).toBe("met");
    expect(wishState(free, "U", kindOf)).toBe("met");
    expect(wishState(free, "K", kindOf)).toBe("met");
    expect(wishState(free, "N", kindOf)).toBe("unmet");
  });
  it("shift wish: met by that shift, open while the day is empty, missed otherwise", () => {
    expect(wishState(early, "F", kindOf)).toBe("met");
    expect(wishState(early, null, kindOf)).toBe("open");
    expect(wishState(early, "N", kindOf)).toBe("unmet");
    expect(wishState(early, "U", kindOf)).toBe("unmet");
  });
  it("a shift wish whose shift type was removed is never counted as met", () => {
    expect(wishState({ ...early, shiftTypeId: null }, null, kindOf)).toBe("open");
  });
  it("summary", () => {
    const s = wishSummary([free, early], { "a|2030-01-02": "N", "a|2030-01-03": "F" }, kindOf);
    expect([s.total, s.met, s.unmet.map((u) => u.wish.date)]).toEqual([2, 1, ["2030-01-02"]]);
  });
});
