/**
 * The ward's local calendar date. Wards work in local time: a night nurse reporting sick at 00:30 means *today* in Germany,
 * which is still yesterday in UTC for one to two hours. WARD_TIME_ZONE overrides the default.
 */
export const wardTimeZone = () =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.WARD_TIME_ZONE || "Europe/Berlin"; // core stays free of Node types

export function localToday(now = new Date(), timeZone = wardTimeZone()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
