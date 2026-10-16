import type { MaybeBalance } from "@dienstplan/db";

const n = (x: number) => String(x).replace(".", ",");
const dmy = (d: string) => d.split("-").reverse().join(".");

export function BalanceCard({ b }: { b: MaybeBalance }) {
  if (!b.configured) return <div className="card text-sm text-slate-500">Für {b.year} ist noch kein Urlaubsanspruch hinterlegt.</div>;
  const neg = b.remaining < 0;
  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">Resturlaub {b.year}</h2>
        <span className={`text-2xl font-semibold ${neg ? "text-rose-600" : ""}`}>{n(b.remaining)} <span className="text-sm font-normal text-slate-500">von {n(b.total)} Tagen</span></span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-slate-500">Anspruch</dt><dd>{n(b.entitlement)}{b.adjustment !== 0 && ` (${b.adjustment > 0 ? "+" : ""}${n(b.adjustment)} Korrektur)`}</dd></div>
        <div><dt className="text-xs text-slate-500">Übertrag Vorjahr</dt><dd>{n(b.carryOver)}{b.forfeited > 0 && <span className="text-rose-600"> ({n(b.forfeited)} verfallen)</span>}</dd></div>
        <div><dt className="text-xs text-slate-500">Genommen</dt><dd>{n(b.taken)}</dd></div>
        <div><dt className="text-xs text-slate-500">Geplant</dt><dd>{n(b.planned + b.approvedHeld)}</dd></div>
        {b.requested > 0 && <div><dt className="text-xs text-slate-500">Beantragt (offen)</dt><dd>{n(b.requested)}</dd></div>}
      </dl>
      {b.expiring > 0 && b.carryOverExpires && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">⚠️ {n(b.expiring)} Tag(e) Übertrag verfallen am {dmy(b.carryOverExpires)}, wenn sie bis dahin nicht genommen werden.</p>}
      <p className="text-xs text-slate-500">{b.mode === "WEEKDAYS" ? "Gezählt werden Urlaubstage von Montag bis Freitag." : "Gezählt werden alle Kalendertage."} Feiertage, unbezahlter Urlaub und Sonderurlaub werden nicht abgezogen.</p>
    </div>
  );
}
