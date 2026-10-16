import { wardBalances } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { defaultEntitlementsAction, rolloverAction, saveEntitlementAction } from "@/app/actions";

const n = (x: number) => String(x).replace(".", ",");

export default async function Urlaubskonto({ searchParams }: { searchParams: Promise<{ y?: string; err?: string; ok?: string }> }) {
  const me = await requireUser(["PLANNER", "ADMIN", "PDL"]);
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : new Date().getUTCFullYear();
  const rows = await wardBalances(me.id, year);
  const canEdit = me.role !== "PDL";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Urlaubskonto {year}</h1>
        <div className="flex gap-2">
          <a className="btn-ghost" href={`/urlaubskonto?y=${year - 1}`} aria-label="Vorjahr">‹</a>
          <a className="btn-ghost" href={`/urlaubskonto?y=${year + 1}`} aria-label="Nächstes Jahr">›</a>
        </div>
      </div>
      {sp.err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{sp.err}</p>}
      {sp.ok === "defaults" && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">Standardanspruch eingetragen (bestehende Einträge blieben unverändert).</p>}
      {sp.ok === "rollover" && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">Jahreswechsel durchgeführt: Resturlaub wurde als Übertrag übernommen.</p>}

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>{["Mitarbeiter:in", "Anspruch", "Übertrag", "Genommen", "Geplant", "Offen", "Rest"].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}{canEdit && <th className="p-3" />}</tr>
          </thead>
          <tbody>
            {rows.map(({ user, entitlement, balance: b }) => (
              <tr key={user.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <th className="p-3 text-left font-medium">{user.name}</th>
                {b.configured ? (
                  <>
                    <td className="p-3">{n(b.entitlement)}{b.adjustment !== 0 && <span className="text-slate-500"> ({b.adjustment > 0 ? "+" : ""}{n(b.adjustment)})</span>}</td>
                    <td className="p-3">{n(b.carryOver)}{b.forfeited > 0 && <span className="text-rose-600"> −{n(b.forfeited)}</span>}{b.expiring > 0 && <span className="text-amber-600"> ⚠ {n(b.expiring)} verfallen bald</span>}</td>
                    <td className="p-3">{n(b.taken)}</td>
                    <td className="p-3">{n(b.planned + b.approvedHeld)}</td>
                    <td className="p-3">{n(b.requested)}</td>
                    <td className={`p-3 font-semibold ${b.remaining < 0 ? "text-rose-600" : ""}`}>{n(b.remaining)}</td>
                  </>
                ) : <td colSpan={6} className="p-3 text-slate-500">Kein Anspruch hinterlegt</td>}
                {canEdit && (
                  <td className="p-3">
                    <details>
                      <summary className="cursor-pointer text-xs underline">{entitlement ? "Ändern" : "Anlegen"}</summary>
                      <form action={saveEntitlementAction.bind(null, user.id, year)} className="mt-2 grid w-64 gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700" aria-label={`Anspruch ${user.name}`}>
                        <label className="text-xs">Jahresanspruch (Tage)<input name="entitlement" inputMode="decimal" required defaultValue={entitlement?.entitlement ?? 30} className="input mt-1" /></label>
                        <label className="text-xs">Übertrag Vorjahr<input name="carryOver" inputMode="decimal" defaultValue={entitlement?.carryOver ?? 0} className="input mt-1" /></label>
                        <label className="text-xs">Übertrag verfällt am<input type="date" name="carryOverExpires" defaultValue={entitlement?.carryOverExpires?.toISOString().slice(0, 10) ?? ""} className="input mt-1" /></label>
                        <label className="text-xs">Korrektur (+/−)<input name="adjustment" inputMode="decimal" defaultValue={entitlement?.adjustment ?? 0} className="input mt-1" /></label>
                        <label className="text-xs">Notiz<input name="note" maxLength={200} defaultValue={entitlement?.note ?? ""} className="input mt-1" /></label>
                        <button className="btn">Speichern</button>
                      </form>
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Genommen/geplant ergibt sich aus dem Dienstplan, „Offen“ sind noch nicht entschiedene Anträge. Es werden nur bezahlte Urlaubstage von Montag bis Freitag abgezogen (Feiertage werden noch nicht berücksichtigt).</p>

      {canEdit && (
        <div className="grid gap-3 md:grid-cols-2">
          <form action={defaultEntitlementsAction.bind(null, year)} className="card flex flex-wrap items-end gap-2">
            <div className="w-full text-sm font-semibold">Standardanspruch für alle ohne Eintrag</div>
            <label className="text-xs">Tage<input name="days" inputMode="decimal" defaultValue="30" className="input mt-1 w-24" /></label>
            <button className="btn-ghost">Eintragen</button>
          </form>
          <form action={rolloverAction.bind(null, year)} className="card flex flex-wrap items-end gap-2">
            <div className="w-full text-sm font-semibold">Jahreswechsel {year} → {year + 1}</div>
            <p className="w-full text-xs text-slate-500">Legt {year + 1} an: gleicher Anspruch, Resturlaub als Übertrag. Bestehende Einträge bleiben unverändert.</p>
            <label className="text-xs">Übertrag verfällt am<input type="date" name="expires" defaultValue={`${year + 1}-03-31`} className="input mt-1" /></label>
            <button className="btn-ghost">Durchführen</button>
          </form>
        </div>
      )}
    </>
  );
}
