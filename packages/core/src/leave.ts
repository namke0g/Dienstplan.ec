const DAY = 86_400_000;
const t = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t(s)) && new Date(t(s)).toISOString().slice(0, 10) === s;

/** All dates from start to end, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = t(start); d <= t(end); d += DAY) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

/** Distinct YYYY-MM months touched by the range, in order. */
export const monthsBetween = (start: string, end: string): string[] => [...new Set(eachDay(start, end).map((d) => d.slice(0, 7)))];

export const rangesOverlap = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;

export const MAX_LEAVE_DAYS = 60;

/** Returns a German error message or null. `today` is injectable for tests. */
export function validateLeaveRange(start: string, end: string, today: string): string | null {
  if (!isYmd(start) || !isYmd(end)) return "Bitte gültige Daten angeben.";
  if (end < start) return "Das Ende liegt vor dem Beginn.";
  if (end < today) return "Der Zeitraum liegt in der Vergangenheit.";
  if (eachDay(start, end).length > MAX_LEAVE_DAYS) return `Ein Antrag darf höchstens ${MAX_LEAVE_DAYS} Tage umfassen.`;
  return null;
}
