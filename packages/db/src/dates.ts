/** Dates are stored as Postgres DATE; we always handle them as YYYY-MM-DD strings in UTC. */
export const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const toYmd = (d: Date) => d.toISOString().slice(0, 10);
export const monthStart = (ymd: string) => toDate(`${ymd.slice(0, 7)}-01`);
export function daysInMonth(ymdMonthStart: string): string[] {
  const [y, m] = ymdMonthStart.split("-").map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ymdMonthStart.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`);
}
