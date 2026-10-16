import Link from "next/link";
import { monthLabel, shiftMonth } from "@/lib/format";

export function MonthNav({ base, month }: { base: string; month: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link className="btn-ghost" href={`${base}?m=${shiftMonth(month, -1)}`} aria-label="Vorheriger Monat">‹</Link>
      <h1 className="min-w-44 text-center text-lg font-semibold capitalize">{monthLabel(month)}</h1>
      <Link className="btn-ghost" href={`${base}?m=${shiftMonth(month, 1)}`} aria-label="Nächster Monat">›</Link>
    </div>
  );
}
