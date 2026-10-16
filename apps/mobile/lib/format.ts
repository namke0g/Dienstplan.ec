export const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const wd = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7);
};
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
export const daysOf = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return Array.from({ length: new Date(Date.UTC(y, mo, 0)).getUTCDate() }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
};
export const fmtTime = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const shiftHours = (startMin: number, endMin: number) => ((endMin <= startMin ? endMin + 1440 : endMin) - startMin) / 60;
