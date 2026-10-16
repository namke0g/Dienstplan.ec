import { describe, expect, it } from "vitest";
import { validateRoster, type ShiftTypeDef } from "../src";

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
});
