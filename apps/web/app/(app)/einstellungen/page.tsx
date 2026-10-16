import { holidays as stateHolidays, STATES, type State } from "@dienstplan/core";
import { wardSettings } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { addWardHolidayAction, removeWardHolidayAction, saveWardSettingsAction } from "@/app/actions";

const dmy = (d: string) => d.split("-").reverse().join(".");

export default async function Einstellungen({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const me = await requireUser(["ADMIN"]);
  const { err, ok } = await searchParams;
  const s = await wardSettings(me.wardId);
  const year = new Date().getUTCFullYear();
  const preview = s.state ? stateHolidays(year, s.state as State) : [];

  return (
    <>
      <h1 className="text-lg font-semibold">Einstellungen · {s.name}</h1>
      {err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{err}</p>}
      {ok && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">{ok}</p>}

      <form action={saveWardSettingsAction} className="card grid gap-4 md:grid-cols-2" aria-label="Urlaub und Feiertage">
        <label className="text-sm font-medium">Bundesland (gesetzliche Feiertage)
          <select name="state" defaultValue={s.state ?? ""} className="input mt-1">
            <option value="">Keine Feiertage berücksichtigen</option>
            {Object.entries(STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500">Feiertage werden im Dienstplan markiert und bei Urlaub nicht abgezogen.</span>
        </label>
        <fieldset className="text-sm">
          <legend className="font-medium">Urlaubstage zählen</legend>
          <label className="mt-1 flex items-center gap-2"><input type="radio" name="mode" value="WEEKDAYS" defaultChecked={s.leaveCountMode === "WEEKDAYS"} /> Montag bis Freitag (5-Tage-Woche)</label>
          <label className="flex items-center gap-2"><input type="radio" name="mode" value="ALL_DAYS" defaultChecked={s.leaveCountMode === "ALL_DAYS"} /> Alle Kalendertage</label>
        </fieldset>
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="holidaysAreLeaveDays" defaultChecked={s.holidaysAreLeaveDays} className="mt-1" />
          <span><b>Feiertage als Urlaubstage zählen</b><br /><span className="text-slate-500">Standard ist aus: Nach dem Bundesurlaubsgesetz sind Feiertage keine Urlaubstage. Manche 24/7-Dienstpläne oder Tarifverträge zählen einen Feiertag, an dem laut Plan Dienst gewesen wäre, dennoch als Urlaubstag – kläre das mit Personalabteilung und Betriebsrat.</span></span>
        </label>
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 md:col-span-2 dark:bg-amber-950 dark:text-amber-100">Änderungen gelten rückwirkend für alle Urlaubskonten, auch vergangener Jahre. Bereits per Jahreswechsel übernommener Resturlaub wird dabei nicht neu berechnet – prüfe danach das Urlaubskonto.</p>
        <div className="md:col-span-2"><button className="btn">Speichern</button></div>
      </form>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2 text-sm">
          <h2 className="font-semibold">Gesetzliche Feiertage {year}{s.state ? ` · ${STATES[s.state as State]}` : ""}</h2>
          {preview.length === 0 ? <p className="text-slate-500">Kein Bundesland gewählt.</p> : (
            <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{preview.map((h) => <li key={h.date}><span className="tabular-nums text-slate-500">{dmy(h.date)}</span> {h.name}</li>)}</ul>
          )}
          <p className="text-xs text-slate-500">Feiertage, die nur in Teilen eines Landes gelten (z. B. Mariä Himmelfahrt in vielen bayerischen Gemeinden, Fronleichnam in Teilen von Sachsen und Thüringen), trägst du rechts als zusätzliche freie Tage ein.</p>
        </div>
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold">Zusätzliche freie Tage der Station</h2>
          {s.extra.length === 0 && <p className="text-slate-500">Keine.</p>}
          <ul className="space-y-1">
            {s.extra.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2">
                <span><span className="tabular-nums text-slate-500">{dmy(h.date)}</span> {h.name}</span>
                <form action={removeWardHolidayAction.bind(null, h.id)}><button className="text-xs underline" aria-label={`${h.name} entfernen`}>entfernen</button></form>
              </li>
            ))}
          </ul>
          <form action={addWardHolidayAction} className="flex flex-wrap items-end gap-2" aria-label="Freien Tag hinzufügen">
            <label className="text-xs">Datum<input type="date" name="date" required className="input mt-1" /></label>
            <label className="min-w-40 flex-1 text-xs">Bezeichnung<input name="name" required maxLength={80} placeholder="z. B. Mariä Himmelfahrt" className="input mt-1" /></label>
            <button className="btn-ghost">Hinzufügen</button>
          </form>
        </div>
      </section>
    </>
  );
}
