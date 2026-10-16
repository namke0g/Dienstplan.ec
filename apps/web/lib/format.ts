export const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const wd = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
export const isWeekend = (ymd: string) => [0, 6].includes(wd(ymd));
export const monthParam = (m?: string) => (m && /^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7));
export const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
};
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
export const fmtTime = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Entwurf", IN_REVIEW: "In Prüfung", CHANGES_REQUESTED: "Änderung angefordert", APPROVED: "Genehmigt", PUBLISHED: "Veröffentlicht",
};
export const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-slate-200 text-slate-800", IN_REVIEW: "bg-amber-100 text-amber-900", CHANGES_REQUESTED: "bg-rose-100 text-rose-900",
  APPROVED: "bg-emerald-100 text-emerald-900", PUBLISHED: "bg-blue-100 text-blue-900",
};
