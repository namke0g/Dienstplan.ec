"use client";
import { useState, useTransition } from "react";
import { WEEKDAYS, wd, isWeekend } from "@/lib/format";
import { setShiftAction } from "@/app/actions";

export interface GridType { id: string; code: string; name: string; color: string }
interface Props {
  planId?: string;
  editable: boolean;
  days: string[];
  staff: { id: string; name: string }[];
  types: GridType[];
  shifts: Record<string, string>; // `${userId}|${date}` -> shiftTypeId
  flagged?: string[]; // cells with rule violations
  highlightUser?: string;
}

export function RosterGrid({ planId, editable, days, staff, types, shifts: initial, flagged = [], highlightUser }: Props) {
  const [shifts, setShifts] = useState(initial);
  const [, start] = useTransition();
  const byId = new Map(types.map((t) => [t.id, t]));
  const cycle = [...types.map((t) => t.id), null];
  const bad = new Set(flagged);

  function click(userId: string, date: string) {
    if (!editable || !planId) return;
    const key = `${userId}|${date}`;
    const next = cycle[(cycle.indexOf(shifts[key] ?? null) + 1) % cycle.length] ?? null;
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
              <th key={d} className={`min-w-9 border-b border-slate-200 p-1 text-center font-medium dark:border-slate-800 ${isWeekend(d) ? "bg-slate-100 dark:bg-slate-800" : ""}`}>
                <div className="text-slate-500">{WEEKDAYS[wd(d)]}</div>{Number(d.slice(8))}
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
                return (
                  <td key={d} className={`border-b border-slate-100 p-0.5 text-center dark:border-slate-800 ${isWeekend(d) ? "bg-slate-50 dark:bg-slate-900/60" : ""}`}>
                    <button type="button" disabled={!editable} onClick={() => click(u.id, d)}
                      aria-label={`${u.name}, ${d}: ${t?.name ?? "frei"}`}
                      className={`h-8 w-full rounded-md font-semibold ${editable ? "hover:ring-2 hover:ring-brand" : "cursor-default"} ${isBad ? "ring-2 ring-rose-500" : ""}`}
                      style={t ? { background: t.color, color: "#fff" } : undefined}>
                      {t?.code ?? ""}
                    </button>
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
          <span className="inline-grid h-5 w-5 place-items-center rounded font-semibold text-white" style={{ background: t.color }}>{t.code}</span>{t.name}
        </span>
      ))}
    </div>
  );
}
