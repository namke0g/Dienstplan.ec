import { describe, expect, it } from "vitest";
import { easterSunday, holidays, holidayMap, isState, STATES } from "../src";

describe("Easter", () => {
  it("matches published dates, including the earliest and latest possible", () => {
    const known: Record<number, string> = {
      2000: "2000-04-23", 2008: "2008-03-23", 2011: "2011-04-24", 2019: "2019-04-21", 2024: "2024-03-31",
      2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16", 2038: "2038-04-25", 2285: "2285-03-22",
    };
    for (const [y, d] of Object.entries(known)) expect(easterSunday(Number(y)), y).toBe(d);
  });
});

const dates = (y: number, s: Parameters<typeof holidays>[1]) => Object.fromEntries(holidays(y, s).map((h) => [h.name, h.date]));

describe("German public holidays", () => {
  it("2026 movable holidays", () => {
    const nw = dates(2026, "NW");
    expect(nw).toMatchObject({ Karfreitag: "2026-04-03", Ostermontag: "2026-04-06", "Christi Himmelfahrt": "2026-05-14", Pfingstmontag: "2026-05-25", Fronleichnam: "2026-06-04", Allerheiligen: "2026-11-01" });
  });

  it("nationwide holidays apply everywhere; there are 9 of them", () => {
    for (const s of Object.keys(STATES) as (keyof typeof STATES)[]) {
      const d = dates(2026, s);
      for (const n of ["Neujahr", "Karfreitag", "Ostermontag", "Tag der Arbeit", "Christi Himmelfahrt", "Pfingstmontag", "Tag der Deutschen Einheit", "1. Weihnachtstag", "2. Weihnachtstag"]) expect(d[n], `${s} ${n}`).toBeDefined();
    }
  });

  it("state-specific holidays", () => {
    expect(dates(2026, "BY")["Heilige Drei Könige"]).toBe("2026-01-06");
    expect(dates(2026, "NI")["Heilige Drei Könige"]).toBeUndefined();
    expect(dates(2026, "SN")["Buß- und Bettag"]).toBe("2026-11-18");
    expect(dates(2025, "SN")["Buß- und Bettag"]).toBe("2025-11-19");
    expect(dates(2024, "SN")["Buß- und Bettag"]).toBe("2024-11-20");
    expect(dates(2023, "SN")["Buß- und Bettag"]).toBe("2023-11-22");
    expect(dates(2026, "SL")["Mariä Himmelfahrt"]).toBe("2026-08-15");
    expect(dates(2026, "BY")["Mariä Himmelfahrt"]).toBeUndefined(); // only in parts of Bavaria: local extra day
    expect(dates(2026, "BB")).toMatchObject({ Ostersonntag: "2026-04-05", Pfingstsonntag: "2026-05-24" });
  });

  it("rule changes over the years", () => {
    expect(dates(2017, "NW").Reformationstag).toBe("2017-10-31"); // nationwide once, for the 500th anniversary
    expect(dates(2016, "NI").Reformationstag).toBeUndefined();
    expect(dates(2018, "NI").Reformationstag).toBe("2018-10-31"); // northern states since 2018
    expect(dates(2018, "BE")["Internationaler Frauentag"]).toBeUndefined();
    expect(dates(2019, "BE")["Internationaler Frauentag"]).toBe("2019-03-08");
    expect(dates(2022, "MV")["Internationaler Frauentag"]).toBeUndefined();
    expect(dates(2023, "MV")["Internationaler Frauentag"]).toBe("2023-03-08");
    expect(dates(2019, "TH").Weltkindertag).toBe("2019-09-20");
    expect(dates(2025, "BE")["Tag der Befreiung"]).toBe("2025-05-08"); // one-off
    expect(dates(2026, "BE")["Tag der Befreiung"]).toBeUndefined();
  });

  it("number of holidays per state (2026)", () => {
    const n = (s: keyof typeof STATES) => holidays(2026, s).length;
    expect(n("BY")).toBe(12); // 9 + Hl. Drei Könige, Fronleichnam, Allerheiligen; Mariä Himmelfahrt is local (most municipalities): extra day
    expect(n("NW")).toBe(11);
    expect(n("BE")).toBe(10);
    expect(n("SN")).toBe(11);
    expect(n("HH")).toBe(10);
  });

  it("holidayMap spans years and adds a ward's own days", () => {
    const m = holidayMap("2026-12-20", "2027-01-10", "BY", [{ date: "2026-12-24", name: "Heiligabend (Haus)" }]);
    expect([...m.keys()]).toEqual(expect.arrayContaining(["2026-12-24", "2026-12-25", "2026-12-26", "2027-01-01", "2027-01-06"]));
    expect(holidayMap("2026-01-01", "2026-12-31", null).size).toBe(0);
    expect(isState("BY")).toBe(true);
    expect(isState("XX")).toBe(false);
  });
});
