import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, validateRoster, type ShiftTypeDef } from "../src";

const types: ShiftTypeDef[] = [
  { id: "F", startMin: 6 * 60, endMin: 14 * 60 },
  { id: "S", startMin: 14 * 60, endMin: 22 * 60 },
  { id: "N", startMin: 21 * 60, endMin: 6 * 60 },
];

describe("roster rules", () => {
  it("flags < 11h rest (Spät -> Früh)", () => {
    const v = validateRoster(
      [
        { userId: "a", date: "2026-11-02", shiftTypeId: "S" },
        { userId: "a", date: "2026-11-03", shiftTypeId: "F" },
      ],
      types,
    );
    expect(v).toEqual([{ rule: "REST_TIME", userId: "a", date: "2026-11-03", restHours: 8 }]);
  });

  it("accounts for overnight shifts (Nacht -> Früh next day)", () => {
    const v = validateRoster(
      [
        { userId: "a", date: "2026-11-02", shiftTypeId: "N" },
        { userId: "a", date: "2026-11-03", shiftTypeId: "F" },
      ],
      types,
    );
    expect(v[0]).toMatchObject({ rule: "REST_TIME", restHours: 24 - 24 });
  });

  it("allows Früh -> Früh", () => {
    expect(
      validateRoster(
        [
          { userId: "a", date: "2026-11-02", shiftTypeId: "F" },
          { userId: "a", date: "2026-11-03", shiftTypeId: "F" },
        ],
        types,
      ),
    ).toEqual([]);
  });

  it("flags the 7th consecutive day once", () => {
    const a = Array.from({ length: 8 }, (_, i) => ({
      userId: "a",
      date: `2026-11-${String(i + 2).padStart(2, "0")}`,
      shiftTypeId: "F",
    }));
    const v = validateRoster(a, types);
    expect(v.filter((x) => x.rule === "MAX_CONSECUTIVE")).toEqual([
      { rule: "MAX_CONSECUTIVE", userId: "a", date: "2026-11-08", days: 7 },
    ]);
  });

  it("flags understaffing", () => {
    const v = validateRoster([{ userId: "a", date: "2026-11-02", shiftTypeId: "F" }], types, {
      minRestHours: 11,
      maxConsecutiveDays: 6,
      minStaffing: { F: 2 },
    });
    expect(v).toEqual([{ rule: "MIN_STAFFING", date: "2026-11-02", shiftTypeId: "F", have: 1, need: 2 }]);
  });

  describe("leave types", () => {
    const withLeave: ShiftTypeDef[] = [
      ...types,
      { id: "U", kind: "VACATION", startMin: 0, endMin: 0 },
      { id: "K", kind: "SICK_PAID", startMin: 0, endMin: 0 },
    ];

    it("does not treat absences as work (no rest-time violation, no staffing, streak breaks)", () => {
      const v = validateRoster(
        [
          { userId: "a", date: "2026-11-02", shiftTypeId: "N" },
          { userId: "a", date: "2026-11-03", shiftTypeId: "U" },
          { userId: "b", date: "2026-11-02", shiftTypeId: "K" },
        ],
        withLeave,
        { ...DEFAULT_RULES, minStaffing: { F: 0 } },
      );
      expect(v).toEqual([]);
    });

    it("an absence interrupts the max-consecutive-days streak", () => {
      const days = ["02", "03", "04", "05", "06", "07", "09", "10"];
      const work = days.map((d) => ({ userId: "a", date: `2026-11-${d}`, shiftTypeId: "F" }));
      const withU = [...work, { userId: "a", date: "2026-11-08", shiftTypeId: "U" }];
      expect(validateRoster(withU, withLeave)).toEqual([]);
    });

    it("still rejects unknown shift types", () => {
      expect(() => validateRoster([{ userId: "a", date: "2026-11-02", shiftTypeId: "X" }], withLeave)).toThrow();
    });
  });
});
