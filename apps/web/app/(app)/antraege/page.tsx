import { leaveImpact, prisma, leaveContext, swapsForPlanner, toYmd } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { decideLeaveAction, decideSwapAction } from "@/app/actions";

const dmy = (d: string) => d.split("-").reverse().join(".");
const range = (s: string, e: string) => (s === e ? dmy(s) : `${dmy(s)} – ${dmy(e)}`);

export default async function AntraegePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const me = await requireUser(["PLANNER", "ADMIN", "PDL"]);
  const { err } = await searchParams;
  const where = { user: { wardId: me.wardId } };
  const [pending, recent] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { ...where, status: "PENDING" }, orderBy: { start: "asc" }, include: { user: { select: { name: true } }, shiftType: true } }),
    prisma.leaveRequest.findMany({ where: { ...where, status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 15, include: { user: { select: { name: true } }, shiftType: true, decidedBy: { select: { name: true } } } }),
  ]);
  const ctx = await Promise.all(pending.map((r) => leaveContext(r.id)));
  // per requested year: days this request deducts and what is left after approval (same rules as the check when it was filed)
  const impact = await Promise.all(pending.map(async (r) =>
    !r.shiftType.consumesLeave ? [] : (await leaveImpact(r.userId, toYmd(r.start), toYmd(r.end))).map((y) => ({ year: y.year, days: y.configured ? y.days : null, remaining: y.remaining }))));
  const swaps = me.role === "PDL" ? [] : await swapsForPlanner(me.id);

  return (
    <>
      <h1 className="text-lg font-semibold">Anträge auf Abwesenheit</h1>
      {err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{err}</p>}
      {swaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Diensttausch zur Freigabe</h2>
          {swaps.map((r) => (
            <form key={r.id} className="card space-y-3" aria-label={`Tausch ${r.requester.name}`}>
              <div className="text-sm"><b>{r.requester.name}</b> ↔ <b>{r.partner?.name}</b>
                <div className="text-slate-500">{r.shiftType.name} am {dmy(toYmd(r.date))}{r.partnerDate ? <> gegen {r.partnerShiftType?.name} am {dmy(toYmd(r.partnerDate))}</> : " (Abgabe ohne Gegendienst)"}</div>
                {r.note && <div>„{r.note}“</div>}</div>
              {r.problems.length > 0 ? <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">Aktuell nicht möglich: {r.problems.join("; ")}</p>
                : <p className="text-xs text-emerald-700">✓ Ruhezeiten und Arbeitstage eingehalten. Der Tausch ändert den veröffentlichten Plan direkt, ohne neue Genehmigung durch PDL/Betriebsrat.</p>}
              <label className="block text-sm font-medium">Kommentar <span className="font-normal text-slate-500">(bei Ablehnung Pflicht)</span><textarea name="comment" rows={2} className="input mt-1" /></label>
              <div className="flex gap-2">
                <button className="btn" disabled={r.problems.length > 0} formAction={decideSwapAction.bind(null, r.id, "APPROVED")}>Freigeben</button>
                <button className="btn-ghost !border-rose-300 !text-rose-700" formAction={decideSwapAction.bind(null, r.id, "REJECTED")}>Ablehnen</button>
              </div>
            </form>
          ))}
        </section>
      )}
      {pending.length === 0 && swaps.length === 0 && <p className="card text-sm text-slate-500">Keine offenen Anträge.</p>}
      {pending.length > 0 && <h2 className="font-semibold">Abwesenheitsanträge</h2>}
      {pending.map((r, i) => {
        const c = ctx[i]!;
        return (
          <form key={r.id} className="card space-y-3" aria-label={`Antrag ${r.user.name}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div><b>{r.user.name}</b> · {r.shiftType.name} {r.shiftType.paid ? "" : "(unbezahlt)"}<div className="text-sm text-slate-500">{range(toYmd(r.start), toYmd(r.end))}</div></div>
              {r.note && <div className="text-sm">„{r.note}“</div>}
            </div>
            {impact[i]!.map((m) => (
              <p key={m.year} className={`text-xs ${m.remaining !== null && m.remaining < 0 ? "text-rose-700" : "text-slate-500"}`}>
                {m.days === null ? `Kein Urlaubsanspruch für ${m.year} hinterlegt.` : `Urlaub ${m.year}: ${m.days} Tag(e) beantragt · Rest nach Genehmigung ${String(m.remaining).replace(".", ",")} Tag(e)${m.remaining! < 0 ? " – Anspruch überschritten" : ""}`}
              </p>
            ))}
            {(c.others.length > 0 || c.clashingShifts > 0) && (
              <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                {c.clashingShifts > 0 && <li>⚠️ {c.clashingShifts} bereits geplante{c.clashingShifts === 1 ? "r" : ""} Dienst{c.clashingShifts === 1 ? "" : "e"} würde{c.clashingShifts === 1 ? "" : "n"} ersetzt.</li>}
                {c.others.map((o, k) => <li key={k}>Zeitgleich: {o.name} – {o.type} {range(o.start, o.end)} ({o.status === "APPROVED" ? "genehmigt" : "offen"})</li>)}
              </ul>
            )}
            <label className="block text-sm font-medium">Kommentar <span className="font-normal text-slate-500">(bei Ablehnung Pflicht)</span><textarea name="comment" rows={2} className="input mt-1" /></label>
            <div className="flex gap-2">
              <button className="btn" formAction={decideLeaveAction.bind(null, r.id, "APPROVED")}>Genehmigen</button>
              <button className="btn-ghost !border-rose-300 !text-rose-700" formAction={decideLeaveAction.bind(null, r.id, "REJECTED")}>Ablehnen</button>
            </div>
          </form>
        );
      })}

      {recent.length > 0 && (
        <>
          <h2 className="font-semibold">Zuletzt entschieden</h2>
          <ul className="space-y-1 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="card !p-3">
                {r.status === "APPROVED" ? "✅" : "❌"} <b>{r.user.name}</b> · {r.shiftType.name} · {range(toYmd(r.start), toYmd(r.end))}
                <span className="text-slate-400"> — {r.decidedBy?.name}</span>
                {r.decisionComment && <div className="text-slate-500">„{r.decisionComment}“</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
