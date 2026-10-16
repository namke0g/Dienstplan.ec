import { describe, expect, it } from "vitest";
import { buildIcs } from "../src";

const now = new Date("2026-10-16T08:00:00Z");
const night = { id: "N", name: "Nachtdienst", startMin: 21 * 60, endMin: 6 * 60 };

describe("ics", () => {
  it("emits stable UIDs and bumps SEQUENCE on change", () => {
    const a = buildIcs([{ id: "s1", date: "2026-11-02", type: night }], { calName: "Dienstplan", now });
    const b = buildIcs([{ id: "s1", date: "2026-11-02", type: night, sequence: 1 }], { calName: "Dienstplan", now });
    expect(a).toContain("UID:shift-s1@dienstplan.local");
    expect(b).toContain("UID:shift-s1@dienstplan.local");
    expect(b).toContain("SEQUENCE:1");
  });

  it("night shift ends next day, floating local time", () => {
    const ics = buildIcs([{ id: "s1", date: "2026-11-02", type: night }], { calName: "x", now });
    expect(ics).toContain("DTSTART:20261102T210000");
    expect(ics).toContain("DTEND:20261103T060000");
  });

  it("uses CRLF, escapes text and folds long lines", () => {
    const ics = buildIcs([{ id: "s1", date: "2026-11-02", type: night, note: "a,b;c " + "x".repeat(100) }], {
      calName: "x",
      now,
    });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).toContain("a\\,b\;c");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
