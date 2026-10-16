import { localToday } from "@dienstplan/core";
import { getBalance, leaveDisplayStatus, prisma, toYmd } from "@dienstplan/db";
import { BalanceCard } from "@/components/BalanceCard";
import { requireUser } from "@/lib/auth";
import { cancelLeaveAction, createLeaveAction, requestLeaveCancellationAction, withdrawLeaveCancellationAction } from "@/app/actions";

const STATUS: Record<string, [string, string]> = {
  PENDING: ["Offen", "bg-amber-100 text-amber-900"], APPROVED: ["Genehmigt", "bg-emerald-100 text-emerald-900"],
  REJECTED: ["Abgelehnt", "bg-rose-100 text-rose-900"], CANCELLED: ["Zurückgezogen", "bg-slate-200 text-slate-700"],
  RETURNED: ["Zurückgegeben", "bg-slate-200 text-slate-700"], RETURN_REQUESTED: ["Rückgabe beantragt", "bg-amber-100 text-amber-900"],
};
const dmy = (d: string) => d.split("-").reverse().join(".");

export default async function UrlaubPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const me = await requireUser();
  const { err, ok } = await searchParams;
  const [types, requests] = await Promise.all([
    prisma.shiftType.findMany({ where: { wardId: me.wardId, kind: { in: ["VACATION", "SPECIAL_LEAVE"] } }, orderBy: [{ consumesLeave: "desc" }, { name: "asc" }] }),
    prisma.leaveRequest.findMany({ where: { userId: me.id }, orderBy: { start: "desc" }, include: { shiftType: true, decidedBy: { select: { name: true } } }, take: 50 }),
  ]);
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const [bal, balNext] = await Promise.all([getBalance(me.id, year), getBalance(me.id, year + 1)]);

  return (
    <>
      <h1 className="text-lg font-semibold">Urlaub &amp; Abwesenheit beantragen</h1>
      {err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{err}</p>}
      {ok && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">Antrag gesendet. Planung und PDL wurden benachrichtigt.</p>}

      <BalanceCard b={bal} />
      {balNext.configured && <BalanceCard b={balNext} />}

      <form action={createLeaveAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium">Art
          <select name="type" required className="input mt-1">{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unbezahlt)"}</option>)}</select></label>
        <label className="text-xs font-medium">Von<input type="date" name="start" required min={today} defaultValue={today} className="input mt-1" /></label>
        <label className="text-xs font-medium">Bis<input type="date" name="end" required min={today} defaultValue={today} className="input mt-1" /></label>
        <label className="text-xs font-medium sm:col-span-2 lg:col-span-1">Anmerkung <span className="font-normal text-slate-500">(bei Sonderurlaub Pflicht)</span>
          <input name="note" maxLength={500} className="input mt-1" /></label>
        <div className="flex items-end"><button className="btn w-full">Antrag senden</button></div>
      </form>
      <p className="text-xs text-slate-500">Krankmeldungen werden nicht beantragt, sondern unter „Krank melden“ erfasst. Genehmigte Abwesenheiten werden in den Dienstplan übernommen und sind für Kolleg:innen sichtbar, sobald der Plan veröffentlicht ist.</p>

      <h2 className="font-semibold">Meine Anträge</h2>
      {requests.length === 0 && <p className="card text-sm text-slate-500">Noch keine Anträge.</p>}
      <ul className="space-y-2">
        {requests.map((r) => {
          const key = leaveDisplayStatus(r, today);
          const [label, cls] = STATUS[key]!;
          return (
            <li key={r.id} className="card flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <b>{r.shiftType.name}</b> · {dmy(toYmd(r.start))}{toYmd(r.start) !== toYmd(r.end) && ` – ${dmy(toYmd(r.end))}`}
                {r.note && <div className="text-slate-500">„{r.note}“</div>}
                {r.status === "REJECTED" && r.decisionComment && <div className="text-rose-700">Grund: {r.decisionComment}</div>}
                {r.decidedBy && r.status !== "CANCELLED" && <div className="text-xs text-slate-400">{r.decidedBy.name}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
                {r.status === "PENDING" && <form action={cancelLeaveAction.bind(null, r.id)}><button className="btn-ghost !py-1">Zurückziehen</button></form>}
                {key === "RETURN_REQUESTED" && <form action={withdrawLeaveCancellationAction.bind(null, r.id)}><button className="btn-ghost !py-1">Rückgabe zurücknehmen</button></form>}
              </div>
              {key === "APPROVED" && toYmd(r.start) > today && (
                <details className="w-full">
                  <summary className="cursor-pointer text-xs text-slate-500">Urlaub zurückgeben …</summary>
                  <form action={requestLeaveCancellationAction.bind(null, r.id)} className="mt-2 flex flex-wrap gap-2" aria-label={`Rückgabe ${r.shiftType.name} ${dmy(toYmd(r.start))}`}>
                    <input name="reason" required maxLength={500} placeholder="Grund" aria-label="Grund für die Rückgabe" className="input flex-1" />
                    <button className="btn-ghost !py-1">Rückgabe beantragen</button>
                  </form>
                  <p className="mt-1 text-xs text-slate-500">Genehmigter Urlaub bleibt bestehen, bis Planung oder PDL zustimmen. Danach sind die Tage wieder frei und werden dem Urlaubskonto gutgeschrieben.</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
