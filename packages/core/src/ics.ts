import { isLeave, type ShiftTypeDef } from "./rules";

export interface IcsShift {
  /** stable id (DB id of the Shift row) so calendar apps update instead of duplicating */
  id: string;
  date: string; // YYYY-MM-DD
  type: ShiftTypeDef & { name: string };
  note?: string;
  /** bumps when the shift changes, so clients refresh it */
  sequence?: number;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const stamp = (date: string, min: number, addDays = 0) => {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + addDays * 86_400_000);
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${ymd}T${hh}${mm}00`;
};

/** Floating-time (local) events, so shifts stay at the right wall-clock time in every timezone. */
export function buildIcs(shifts: IcsShift[], opts: { calName: string; domain?: string; now?: Date }): string {
  const domain = opts.domain ?? "dienstplan.local";
  const dtstamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dienstplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.calName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const s of shifts) {
    if (isLeave(s.type.kind)) {
      // absences are all-day events (DTEND is exclusive)
      lines.push(
        "BEGIN:VEVENT",
        `UID:shift-${s.id}@${domain}`,
        `DTSTAMP:${dtstamp}`,
        `SEQUENCE:${s.sequence ?? 0}`,
        `DTSTART;VALUE=DATE:${stamp(s.date, 0).slice(0, 8)}`,
        `DTEND;VALUE=DATE:${stamp(s.date, 0, 1).slice(0, 8)}`,
        `SUMMARY:${esc(s.type.name)}`,
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
      continue;
    }
    const overnight = s.type.endMin <= s.type.startMin;
    lines.push(
      "BEGIN:VEVENT",
      `UID:shift-${s.id}@${domain}`,
      `DTSTAMP:${dtstamp}`,
      `SEQUENCE:${s.sequence ?? 0}`,
      `DTSTART:${stamp(s.date, s.type.startMin)}`,
      `DTEND:${stamp(s.date, s.type.endMin, overnight ? 1 : 0)}`,
      `SUMMARY:${esc(s.type.name)}`,
      ...(s.note ? [`DESCRIPTION:${esc(s.note)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
