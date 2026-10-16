import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOf, fmtTime, shiftHours, shiftMonth } from "./format.ts";

test("month helpers", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(daysOf("2028-02").length, 29);
});
test("shift times", () => {
  assert.equal(fmtTime(21 * 60), "21:00");
  assert.equal(shiftHours(21 * 60, 7 * 60), 10); // night shift crosses midnight
  assert.equal(shiftHours(6 * 60, 14 * 60 + 30), 8.5);
});
