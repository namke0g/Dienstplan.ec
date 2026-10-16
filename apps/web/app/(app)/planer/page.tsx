import { prisma, getOrCreatePlan, daysInMonth } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { describeViolation, draftShifts, monthHolidays, toGridTypes, violationsFor, wardContext } from "@/lib/roster";
import { fmtTime, monthParam } from "@/lib/format";
import { MonthNav } from "@/components/MonthNav";
import { StatusBadge } from "@/components/StatusBadge";
import { Legend, RosterGrid } from "@/components/RosterGrid";
import { applyLeaveAction, publishAction, submitAction } from "@/app/actions";

export default async function PlanerPage({ searchParams }: { searchParams: Promise<{ m?: string; err?: string }> }) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  const sp = await searchParams;
  const month = monthParam(sp.m);
  const [{ staff, types }, holidays] = await Promise.all([wardContext(me.wardId, [month]), monthHolidays(me.wardId, month)]);
  const plan = await getOrCreatePlan(me.wardId, `${month}-01`);
  const shifts = await draftShifts(plan.id);
  const approvals = await prisma.approval.findMany({ where: { planId: plan.id, version: plan.version }, include: { decidedBy: { select: { name: true } } } });
  const heldLeave = await prisma.leaveRequest.findMany({ where: { status: "APPROVED", pendingMonths: { has: month }, user: { wardId: me.wardId } }, include: { user: { select: { name: true } }, shiftType: true } });
  const violations = violationsFor(shifts, types);
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const flagged = violations.flatMap((v) => ("userId" in v ? [`${v.userId}|${v.date}`] : []));
  const editable = plan.status === "DRAFT" || plan.status === "CHANGES_REQUESTED" || plan.status === "PUBLISHED" || plan.status === "APPROVED";
  const needsSubmit = plan.status === "DRAFT" || plan.status === "CHANGES_REQUESTED";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav base="/planer" month={month} />
        <div className="flex items-center gap-3">
          <StatusBadge status={plan.status} /><span className="text-xs text-slate-500">Version {plan.version}</span>
          {needsSubmit && <form action={submitAction.bind(null, plan.id)}><button className="btn" disabled={shifts.length === 0}>Zur Prüfung einreichen</button></form>}
          {plan.status === "APPROVED" && <form action={publishAction.bind(null, plan.id)}><button className="btn">Veröffentlichen</button></form>}
        </div>
      </div>

      {plan.status === "IN_REVIEW" && <p className="card text-sm">Der Plan liegt bei PDL und Betriebsrat zur Prüfung. Änderungen sind jetzt gesperrt.</p>}
      {plan.status === "PUBLISHED" && <p className="card text-sm">Plan ist online. Jede Änderung erzeugt eine neue Version, die erneut von PDL und Betriebsrat genehmigt werden muss. Mitarbeitende sehen bis dahin die veröffentlichte Version.</p>}

      {sp.err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{sp.err}</p>}
      {heldLeave.length > 0 && (
        <div className="card space-y-2 border-amber-300 text-sm">
          <b>Genehmigte Abwesenheiten, die noch nicht im Plan stehen ({heldLeave.length})</b>
          <p className="text-slate-500">{plan.status === "IN_REVIEW" ? "Der Plan ist in Prüfung – übernimm sie nach der Entscheidung." : "Das Übernehmen ändert den Plan und startet eine neue Version, die erneut genehmigt werden muss."}</p>
          {heldLeave.map((r) => (
            <form key={r.id} action={applyLeaveAction.bind(null, r.id, month)} className="flex flex-wrap items-center justify-between gap-2">
              <span>{r.user.name} · {r.shiftType.name} · {r.start.toISOString().slice(0, 10).split("-").reverse().join(".")} – {r.end.toISOString().slice(0, 10).split("-").reverse().join(".")}</span>
              <button className="btn-ghost !py-1" disabled={plan.status === "IN_REVIEW"}>In Plan übernehmen</button>
            </form>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {["PDL", "BETRIEBSRAT"].map((role) => {
          const a = approvals.find((x) => x.role === role);
          return (
            <div key={role} className="card text-sm">
              <div className="flex justify-between"><b>{role === "PDL" ? "PDL" : "Betriebsrat"}</b>
                <span>{!a || a.decision === "PENDING" ? "⏳ offen" : a.decision === "APPROVED" ? "✅ genehmigt" : "❌ abgelehnt"}</span></div>
              {a?.comment && <p className="mt-1 text-slate-600 dark:text-slate-300">„{a.comment}“ {a.decidedBy && <span className="text-slate-400">— {a.decidedBy.name}</span>}</p>}
            </div>
          );
        })}
      </div>

      <Legend types={toGridTypes(types)} />
      <RosterGrid key={`${plan.id}-${plan.version}-${plan.status}`} planId={plan.id} editable={editable && plan.status !== "IN_REVIEW"} days={daysInMonth(`${month}-01`)} staff={staff}
        types={toGridTypes(types)}
        shifts={Object.fromEntries(shifts.map((s) => [`${s.userId}|${s.date}`, s.shiftTypeId]))} flagged={flagged} holidays={holidays} />
      {Object.keys(holidays).length > 0 && <p className="text-xs text-rose-700 dark:text-rose-300">Feiertage: {Object.entries(holidays).map(([d, n]) => `${d.slice(8)}.${d.slice(5, 7)}. ${n}`).join(" · ")}</p>}
      <p className="text-xs text-slate-500">Klick auf ein Feld öffnet die Auswahl: {types.filter((t) => t.kind === "WORK").map((t) => `${t.code} ${fmtTime(t.startMin)}–${fmtTime(t.endMin)}`).join(" · ")}. Abwesenheiten (Urlaub, Krank, Sonderurlaub) zählen nicht als Arbeitstage und nicht zur Mindestbesetzung.</p>

      {violations.length > 0 && (
        <div className="card border-rose-200">
          <h2 className="mb-2 text-sm font-semibold">Regelverstöße ({violations.length})</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{violations.map((v, i) => <li key={i}>{describeViolation(v, names, typeName)}</li>)}</ul>
        </div>
      )}
    </>
  );
}
