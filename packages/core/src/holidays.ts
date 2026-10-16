/**
 * German public holidays (gesetzliche Feiertage) per federal state.
 * Holidays that only apply in parts of a state (e.g. Fronleichnam in parts of Saxony/Thuringia, Mariä Himmelfahrt in most
 * Bavarian municipalities, Augsburger Friedensfest) are not included: wards add those as local extra days.
 */
export const STATES = {
  BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg", HE: "Hessen",
  MV: "Mecklenburg-Vorpommern", NI: "Niedersachsen", NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz", SL: "Saarland",
  SN: "Sachsen", ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen",
} as const;
export type State = keyof typeof STATES;
export const isState = (s: unknown): s is State => typeof s === "string" && s in STATES;

export interface Holiday { date: string; name: string }

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const plus = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Easter Sunday (Gregorian calendar), anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** Buß- und Bettag: the Wednesday before 23 November. */
const bussUndBettag = (year: number) => {
  let d = ymd(year, 11, 22);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = plus(d, -1);
  return d;
};

export function holidays(year: number, state: State): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: ymd(year, 1, 1), name: "Neujahr" },
    { date: plus(easter, -2), name: "Karfreitag" },
    { date: plus(easter, 1), name: "Ostermontag" },
    { date: ymd(year, 5, 1), name: "Tag der Arbeit" },
    { date: plus(easter, 39), name: "Christi Himmelfahrt" },
    { date: plus(easter, 50), name: "Pfingstmontag" },
    { date: ymd(year, 10, 3), name: "Tag der Deutschen Einheit" },
    { date: ymd(year, 12, 25), name: "1. Weihnachtstag" },
    { date: ymd(year, 12, 26), name: "2. Weihnachtstag" },
  ];
  const add = (cond: boolean, date: string, name: string) => { if (cond) list.push({ date, name }); };
  const inS = (...s: State[]) => s.includes(state);

  add(inS("BW", "BY", "ST"), ymd(year, 1, 6), "Heilige Drei Könige");
  add((state === "BE" && year >= 2019) || (state === "MV" && year >= 2023), ymd(year, 3, 8), "Internationaler Frauentag");
  add(inS("BB", "HE"), easter, "Ostersonntag"); // statutory in Brandenburg and Hessen (HFeiertagsG § 1)
  add(inS("BB", "HE"), plus(easter, 49), "Pfingstsonntag");
  add(state === "BE" && (year === 2020 || year === 2025), ymd(year, 5, 8), "Tag der Befreiung");
  add(inS("BW", "BY", "HE", "NW", "RP", "SL"), plus(easter, 60), "Fronleichnam");
  add(state === "SL", ymd(year, 8, 15), "Mariä Himmelfahrt");
  add(state === "TH" && year >= 2019, ymd(year, 9, 20), "Weltkindertag");
  add(inS("BB", "MV", "SN", "ST", "TH") || (inS("HB", "HH", "NI", "SH") && year >= 2018) || year === 2017, ymd(year, 10, 31), "Reformationstag");
  add(inS("BW", "BY", "NW", "RP", "SL"), ymd(year, 11, 1), "Allerheiligen");
  add(state === "SN", bussUndBettag(year), "Buß- und Bettag");
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

/** All holiday dates between two dates (inclusive) for a state plus a ward's own extra days. */
export function holidayMap(from: string, to: string, state: State | null, extra: Holiday[] = []): Map<string, string> {
  const out = new Map<string, string>();
  if (state) for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) for (const h of holidays(y, state)) if (h.date >= from && h.date <= to) out.set(h.date, h.name);
  for (const h of extra) if (h.date >= from && h.date <= to) out.set(h.date, h.name);
  return out;
}
