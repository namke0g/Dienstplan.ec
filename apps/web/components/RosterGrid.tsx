"use client";
import { useEffect, useState, useTransition } from "react";
import { WEEKDAYS, wd, isWeekend } from "@/lib/format";
import { setShiftAction } from "@/app/actions";
import { wishState } from "@dienstplan/core";

export interface GridType { id: string; code: string; name: string; color: string; kind: string; paid: boolean }
interface Props {
  planId?: string;
  editable: boolean;
  days: string[];
  staff: { id: string; name: string }[];
  types: GridType[];
  shifts: Record<string, string>; // `${userId}|${date}` -> shiftTypeId
  flagged?: string[]; // cells with rule violations
  holidays?: Record<string, string>; // date -> name of public holidays / ward days off
  highlightUser?: string;
  /** planner only: `${userId}|${date}` -> the employee's wish for that day */
  wishes?: Record<string, { kind: "FREE" | "SHIFT"; shiftTypeId: string | null; note: string | null }>;
}

export function RosterGrid({ planId, editable, days, staff, types, shifts: initial, flagged = [], highlightUser, holidays = {}, wishes = {} }: Props) {
  const [shifts, setShifts] = useState(initial);
  const [, start] = useTransition();
  const byId = new Map(types.map((t) => [t.id, t]));
  const bad = new Set(flagged);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const close = (e: KeyboardEvent | MouseEvent) => { if (!(e instanceof KeyboardEvent) || e.key === "Escape") setOpen(null); };
    if (open) { window.addEventListener("keydown", close); window.addEventListener("click", close); }
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("click", close); };
  }, [open]);
  const work = types.filter((t) => t.kind === "WORK");
  const absences = types.filter((t) => t.kind !== "WORK");

  function pick(userId: string, date: string, next: string | null) {
    if (!editable || !planId) return;
    const key = `${userId}|${date}`;
    setOpen(null);
    setShifts((s) => { const n = { ...s }; if (next) n[key] = next; else delete n[key]; return n; });
    start(() => setShiftAction(planId, userId, date, next));
  }

  return (
    <div className="card overflow-x-auto !p-0">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-36 border-b border-slate-200 bg-white p-2 text-left dark:border-slate-800 dark:bg-slate-900">Mitarbeiter:in</th>
            {days.map((d) => (
              <th key={d} title={holidays[d]} className={`min-w-9 border-b border-slate-200 p-1 text-center font-medium dark:border-slate-800 ${holidays[d] ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-200" : isWeekend(d) ? "bg-slate-100 dark:bg-slate-800" : ""}`}>
                <div className={holidays[d] ? "" : "text-slate-500"}>{WEEKDAYS[wd(d)]}</div>{Number(d.slice(8))}
                {holidays[d] && <span className="sr-only">, Feiertag: {holidays[d]}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {staff.map((u) => (
            <tr key={u.id} className={highlightUser === u.id ? "bg-blue-50 dark:bg-blue-950/40" : ""}>
              <th className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white p-2 text-left font-medium dark:border-slate-800 dark:bg-slate-900">{u.name}</th>
              {days.map((d) => {
                const t = byId.get(shifts[`${u.id}|${d}`] ?? "");
                const isBad = bad.has(`${u.id}|${d}`);
                const wish = wishes[`${u.id}|${d}`];
                const wished = wish && (wish.kind === "FREE" ? "Wunschfrei" : `Wunsch ${byId.get(wish.shiftTypeId ?? "")?.name ?? "Dienst"}`);
                const missed = wish && wishState({ userId: u.id, date: d, ...wish }, t?.id ?? null, (id) => byId.get(id)?.kind) === "unmet";
                return (
                  <td key={d} className={`border-b border-slate-100 p-0.5 text-center dark:border-slate-800 ${holidays[d] ? "bg-rose-50/60 dark:bg-rose-950/40" : isWeekend(d) ? "bg-slate-50 dark:bg-slate-900/60" : ""}`}>
                    <div className="relative">
                    <button type="button" disabled={!editable} onClick={(e) => { e.stopPropagation(); setOpen(open === `${u.id}|${d}` ? null : `${u.id}|${d}`); }}
                      aria-label={`${u.name}, ${d}: ${t?.name ?? "frei"}${wished ? ` (${wished}${missed ? ", nicht erfüllt" : ""})` : ""}`} aria-haspopup="menu" aria-expanded={open === `${u.id}|${d}`}
                      title={wish ? `${wished}${wish.note ? `: ${wish.note}` : ""}` : undefined}
                      className={`h-8 w-full rounded-md text-[11px] font-semibold ${t ? "dark:outline dark:outline-1 dark:outline-white/25" : ""} ${editable ? "hover:ring-2 hover:ring-brand" : "cursor-default"} ${isBad ? "ring-2 ring-rose-500" : missed ? "ring-2 ring-amber-400" : wish && !t ? "border border-dashed border-amber-400" : ""}`}
                      style={t ? { background: t.color, color: "#fff" } : undefined}>
                      {t?.code ?? (wish ? <span className="text-amber-600">{wish.kind === "FREE" ? "♡" : `♡${byId.get(wish.shiftTypeId ?? "")?.code ?? ""}`}</span> : "")}
                    </button>
                    {wish && t && <span aria-hidden className="pointer-events-none absolute right-0.5 top-0 text-[8px] text-amber-300">♡</span>}
                    {open === `${u.id}|${d}` && (
                      <div role="menu" onClick={(e) => e.stopPropagation()} className="absolute left-1/2 top-9 z-30 w-56 -translate-x-1/2 space-y-1 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900">
                        {[["Dienste", work], ["Abwesenheit", absences]].map(([label, list]) => (
                          <div key={label as string}>
                            <div className="px-1 pt-1 text-[10px] font-semibold uppercase text-slate-400">{label as string}</div>
                            {(list as GridType[]).map((o) => (
                              <button key={o.id} role="menuitem" type="button" onClick={() => pick(u.id, d, o.id)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                                <span className="grid h-5 w-6 shrink-0 place-items-center rounded text-[10px] font-semibold text-white dark:outline dark:outline-1 dark:outline-white/25" style={{ background: o.color }}>{o.code}</span>
                                <span className="truncate">{o.name}</span>
                                {o.kind !== "WORK" && <span className="ml-auto text-[10px] text-slate-400">{o.paid ? "bezahlt" : "unbezahlt"}</span>}
                              </button>
                            ))}
                          </div>
                        ))}
                        <button role="menuitem" type="button" onClick={() => pick(u.id, d, null)} className="w-full rounded-lg px-1.5 py-1 text-left text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Frei / leeren</button>
                      </div>
                    )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend({ types }: { types: GridType[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
      {types.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1.5">
          <span className="inline-grid h-5 min-w-5 place-items-center rounded px-1 font-semibold text-white dark:outline dark:outline-1 dark:outline-white/25" style={{ background: t.color }}>{t.code}</span>{t.name}{t.kind !== "WORK" && t.code !== "–" && <span className="text-slate-400">({t.paid ? "bezahlt" : "unbezahlt"})</span>}
        </span>
      ))}
    </div>
  );
}
