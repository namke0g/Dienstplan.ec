import { describe, expect, it } from "vitest";
import { applyChanges, newViolations, swapChanges, SwapConflict, type Assignment, type ShiftTypeDef, type SwapSpec } from "../src";

const types: ShiftTypeDef[] = [
  { id: "F", startMin: 360, endMin: 870 },
  { id: "S", startMin: 780, endMin: 1290 },
  { id: "N", startMin: 1260, endMin: 420 },
  { id: "U", startMin: 0, endMin: 0, kind: "VACATION" },
];
const roster: Assignment[] = [
  { userId: "a", date: "2026-11-02", shiftTypeId: "F" },
  { userId: "b", date: "2026-11-04", shiftTypeId: "S" },
  { userId: "b", date: "2026-11-02", shiftTypeId: "N" },
];
const spec = (o: Partial<SwapSpec>): SwapSpec => ({ requesterId: "a", partnerId: "b", date: "2026-11-02", shiftTypeId: "F", partnerDate: null, partnerShiftTypeId: null, ...o });

describe("swap changes", () => {
  it("hand-over moves the shift to the partner", () => {
    const r = [{ userId: "a", date: "2026-11-02", shiftTypeId: "F" }];
    expect(applyChanges(r, swapChanges(spec({ partnerId: "c" }), r))).toEqual([{ userId: "c", date: "2026-11-02", shiftTypeId: "F" }]);
  });
  it("swap on different days exchanges both shifts", () => {
    const r = roster.filter((x) => !(x.userId === "b" && x.date === "2026-11-02"));
    const out = applyChanges(r, swapChanges(spec({ partnerDate: "2026-11-04", partnerShiftTypeId: "S" }), r));
    expect(out).toContainEqual({ userId: "a", date: "2026-11-04", shiftTypeId: "S" });
    expect(out).toContainEqual({ userId: "b", date: "2026-11-02", shiftTypeId: "F" });
    expect(out).toHaveLength(2);
  });
  it("same-day swap exchanges the shift types", () => {
    const out = applyChanges(roster, swapChanges(spec({ partnerDate: "2026-11-02", partnerShiftTypeId: "N" }), roster));
    expect(out).toContainEqual({ userId: "a", date: "2026-11-02", shiftTypeId: "N" });
    expect(out).toContainEqual({ userId: "b", date: "2026-11-02", shiftTypeId: "F" });
  });
  it("conflicts: stale request, taken target cell, self", () => {
    expect(() => swapChanges(spec({ shiftTypeId: "S" }), roster)).toThrow(SwapConflict);
    expect(() => swapChanges(spec({}), roster)).toThrow(/bereits einen Eintrag/); // b already works on 11-02
    expect(() => swapChanges(spec({ partnerId: "a" }), roster)).toThrow(/mit dir selbst/);
    expect(() => swapChanges(spec({ partnerDate: "2026-11-04", partnerShiftTypeId: "F" }), roster)).toThrow(/nicht mehr/);
  });
});

describe("swap rule check", () => {
  it("flags rest-time violations the swap introduces, ignores existing ones", () => {
    // b works Spät on 11-04; taking a's Früh on 11-05 would give 8.5h rest
    const r: Assignment[] = [{ userId: "a", date: "2026-11-05", shiftTypeId: "F" }, { userId: "b", date: "2026-11-04", shiftTypeId: "S" }];
    const ch = swapChanges(spec({ date: "2026-11-05" }), r);
    expect(newViolations(r, ch, types)).toEqual([{ rule: "REST_TIME", userId: "b", date: "2026-11-05", restHours: 8.5 }]);
  });
  it("is clean when the roster stays legal, and pre-existing violations are not blamed on the swap", () => {
    const r: Assignment[] = [
      { userId: "a", date: "2026-11-02", shiftTypeId: "F" },
      { userId: "b", date: "2026-11-09", shiftTypeId: "S" }, { userId: "b", date: "2026-11-10", shiftTypeId: "F" }, // existing violation of b
    ];
    expect(newViolations(r, swapChanges(spec({}), r), types)).toEqual([]);
  });
  it("absences do not trigger rules", () => {
    const r: Assignment[] = [{ userId: "a", date: "2026-11-02", shiftTypeId: "F" }, { userId: "b", date: "2026-11-01", shiftTypeId: "U" }];
    expect(newViolations(r, swapChanges(spec({}), r), types)).toEqual([]);
  });
});
