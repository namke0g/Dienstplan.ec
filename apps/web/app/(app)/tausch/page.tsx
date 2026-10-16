import Link from "next/link";
import { canTake, swapBoard, toYmd, upcomingShifts } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { acceptSwapAction, cancelSwapAction, declineSwapAction } from "@/app/actions";
import { fmtTime, WEEKDAYS, wd } from "@/lib/format";

const dmy = (d: string) => d.split("-").reverse().join(".");
const STATUS: Record<string, [string, string]> = {
  OPEN: ["Offen für alle", "bg-sky-100 text-sky-900"], PENDING_PARTNER: ["Wartet auf Zusage", "bg-amber-100 text-amber-900"],
  PENDING_PLANNER: ["Wartet auf Planung", "bg-amber-100 text-amber-900"], APPLIED: ["Durchgeführt", "bg-emerald-100 text-emerald-900"],
  DECLINED: ["Abgelehnt", "bg-rose-100 text-rose-900"], REJECTED: ["Nicht genehmigt", "bg-rose-100 text-rose-900"],
  CANCELLED: ["Zurückgezogen", "bg-slate-200 text-slate-700"], EXPIRED: ["Abgelaufen", "bg-slate-200 text-slate-700"],
};

export default async function TauschPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const me = await requireUser(["EMPLOYEE"]);
  const { err, ok } = await searchParams;
  const [board, shifts] = await Promise.all([swapBoard(me.id), upcomingShifts(me.id, 60)]);
  const takeProblems = new Map(await Promise.all(board.open.map(async (r) => [r.id, await canTake(r.id, me.id)] as const)));
  const day = (d: string) => `${WEEKDAYS[wd(d)]} ${dmy(d)}`;
  const busy = new Set(board.mine.filter((r) => ["OPEN", "PENDING_PARTNER", "PENDING_PLANNER"].includes(r.status)).map((r) => toYmd(r.date)));

  return (
    <>
      <h1 className="text-lg font-semibold">Diensttausch</h1>
      {err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{err}</p>}
      {ok && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">Anfrage gesendet.</p>}
      <p className="max-w-prose text-sm text-slate-600 dark:text-slate-300">Tausche einen Dienst mit einer Kollegin/einem Kollegen oder biete ihn allen an. Wenn jemand zustimmt und die Ruhezeiten passen, gibt die Planung den Tausch frei – auch am selben Tag.</p>

      {board.forMe.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">An dich gerichtet</h2>
          {board.forMe.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
              <div><b>{r.requester.name}</b> möchte {r.partnerDate ? <>seinen/ihren <b>{r.shiftType.name}</b> am {day(toYmd(r.date))} gegen deinen <b>{r.partnerShiftType?.name}</b> am {day(toYmd(r.partnerDate))} tauschen</> : <><b>{r.shiftType.name}</b> am {day(toYmd(r.date))} an dich abgeben</>}.
                {r.note && <div className="text-slate-500">„{r.note}“</div>}</div>
              <div className="flex gap-2">
                <form action={acceptSwapAction.bind(null, r.id)}><button className="btn">Zustimmen</button></form>
                <form action={declineSwapAction.bind(null, r.id)}><button className="btn-ghost">Ablehnen</button></form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Offene Angebote im Team</h2>
        {board.open.length === 0 && <p className="card text-sm text-slate-500">Zurzeit bietet niemand einen Dienst an.</p>}
        {board.open.map((r) => {
          const problems = takeProblems.get(r.id) ?? [];
          return (
            <div key={r.id} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
              <div><b>{r.requester.name}</b> gibt <b>{r.shiftType.name}</b> ab · {day(toYmd(r.date))} · {fmtTime(r.shiftType.startMin)}–{fmtTime(r.shiftType.endMin)}
                {r.note && <div className="text-slate-500">„{r.note}“</div>}
                {problems.length > 0 && <div className="text-rose-700">Für dich nicht möglich: {problems.join("; ")}</div>}</div>
              <form action={acceptSwapAction.bind(null, r.id)}><button className="btn" disabled={problems.length > 0}>Übernehmen</button></form>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Meine kommenden Dienste</h2>
        {shifts.length === 0 && <p className="card text-sm text-slate-500">Keine veröffentlichten Dienste in den nächsten 60 Tagen.</p>}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shifts.map((s) => (
            <li key={s.date} className="card flex items-center justify-between gap-2 !p-3 text-sm">
              <span><b>{day(s.date)}</b><br /><span className="text-slate-500">{s.type.name} {fmtTime(s.type.startMin)}–{fmtTime(s.type.endMin)}</span></span>
              {busy.has(s.date) ? <span className="text-xs text-slate-400">Anfrage läuft</span> : <Link className="btn-ghost !py-1" href={`/tausch/neu?date=${s.date}`}>Tauschen</Link>}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Meine Anfragen</h2>
        {board.mine.length === 0 && <p className="card text-sm text-slate-500">Noch keine Anfragen.</p>}
        {board.mine.map((r) => {
          const [label, cls] = STATUS[r.status]!;
          return (
            <div key={r.id} className="card flex flex-wrap items-center justify-between gap-2 text-sm">
              <div><b>{r.shiftType.name}</b> am {day(toYmd(r.date))} → {r.partner ? <b>{r.partner.name}</b> : "alle"}{r.partnerDate && <> gegen {r.partnerShiftType?.name} am {day(toYmd(r.partnerDate))}</>}
                {r.status === "REJECTED" && r.decisionComment && <div className="text-rose-700">Grund: {r.decisionComment}</div>}</div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
                {["OPEN", "PENDING_PARTNER", "PENDING_PLANNER"].includes(r.status) && <form action={cancelSwapAction.bind(null, r.id)}><button className="btn-ghost !py-1">Zurückziehen</button></form>}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
