import { localToday } from "@dienstplan/core";
import { prisma, sickReportsFor } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { createSickAction, endSickAction, extendSickAction } from "@/app/actions";

const dmy = (d: string) => d.split("-").reverse().join(".");
const range = (a: string, b: string) => (a === b ? dmy(a) : `${dmy(a)} – ${dmy(b)}`);

export default async function Krank({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const me = await requireUser();
  const { err, ok } = await searchParams;
  const manager = ["PLANNER", "ADMIN", "PDL"].includes(me.role);
  const today = localToday();
  const [reports, staff] = await Promise.all([
    sickReportsFor(me.id),
    manager ? prisma.user.findMany({ where: { wardId: me.wardId, role: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  if (!manager && me.role !== "EMPLOYEE") return <p className="card text-sm">Krankmeldungen gibt es für Mitarbeitende mit Dienstplan.</p>;

  return (
    <>
      <h1 className="text-lg font-semibold">{manager ? "Krankmeldungen" : "Krank melden"}</h1>
      {err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{err}</p>}
      {ok && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">{ok}</p>}

      <form action={createSickAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Krankmeldung erfassen">
        {manager && (
          <label className="text-xs font-medium lg:col-span-2">Für
            <select name="userId" required className="input mt-1">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        )}
        <label className="text-xs font-medium">Erster Krankheitstag<input type="date" name="start" required defaultValue={today} className="input mt-1" /></label>
        <label className="text-xs font-medium">Voraussichtlich bis<input type="date" name="end" required defaultValue={today} className="input mt-1" /></label>
        <label className="text-xs font-medium sm:col-span-2 lg:col-span-1">Hinweis <span className="font-normal text-slate-500">(optional)</span>
          <input name="note" maxLength={200} placeholder="z. B. eAU folgt" className="input mt-1" /></label>
        <div className="flex items-end"><button className="btn w-full">{manager ? "Erfassen" : "Krank melden"}</button></div>
        <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-5">Bitte <b>keine Diagnose</b> angeben – sie geht niemanden etwas an. Die Tage werden sofort im Dienstplan als krank eingetragen; Kolleg:innen sehen nur „abwesend“. Die Planung wird benachrichtigt. Ab dem 4. Krankheitstag (oder früher, wenn vereinbart) braucht es eine ärztliche Bescheinigung; der Arbeitgeber ruft sie als eAU bei der Krankenkasse ab.</p>
      </form>

      <h2 className="font-semibold">{manager ? "Aktuelle und kürzliche Krankmeldungen" : "Meine Krankmeldungen"}</h2>
      {reports.length === 0 && <p className="card text-sm text-slate-500">Keine.</p>}
      <ul className="space-y-2">
        {reports.map((r) => (
          <li key={r.id} className="card space-y-2 text-sm" aria-label={`Krankmeldung ${r.name}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{manager && <b>{r.name} · </b>}{range(r.start, r.end)}{r.note && <span className="text-slate-500"> · {r.note}</span>}</span>
              <span className="text-xs text-slate-500">{r.selfReported ? "selbst gemeldet" : `erfasst von ${r.reportedBy}`}{r.active ? "" : " · beendet"}</span>
            </div>
            {r.active && (
              <div className="flex flex-wrap gap-4">
                <form action={extendSickAction.bind(null, r.id)} className="flex items-end gap-2">
                  <label className="text-xs">Verlängern bis<input type="date" name="end" required min={r.end} className="input mt-1" /></label>
                  <button className="btn-ghost !py-1.5">Verlängern</button>
                </form>
                <form action={endSickAction.bind(null, r.id)} className="flex items-end gap-2">
                  <label className="text-xs">Wieder gesund ab<input type="date" name="backOn" required min={r.start} max={r.end} defaultValue={r.start > today ? r.start : today <= r.end ? today : r.end} className="input mt-1" /></label>
                  <button className="btn-ghost !py-1.5">Speichern</button>
                </form>
              </div>
            )}
            {r.active && <p className="text-xs text-slate-500">„Wieder gesund ab“ dem ersten Krankheitstag nimmt die Krankmeldung ganz zurück.</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
