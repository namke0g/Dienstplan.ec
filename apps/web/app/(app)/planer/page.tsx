import { prisma, getOrCreatePlan, daysInMonth } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { describeViolation, draftShifts, violationsFor, wardContext } from "@/lib/roster";
import { fmtTime, monthParam } from "@/lib/format";
import { MonthNav } from "@/components/MonthNav";
import { StatusBadge } from "@/components/StatusBadge";
import { Legend, RosterGrid } from "@/components/RosterGrid";
import { publishAction, submitAction } from "@/app/actions";

export default async function PlanerPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  const month = monthParam((await searchParams).m);
  const { staff, types } = await wardContext(me.wardId);
  const plan = await getOrCreatePlan(me.wardId, `${month}-01`);
  const shifts = await draftShifts(plan.id);
  const approvals = await prisma.approval.findMany({ where: { planId: plan.id, version: plan.version }, include: { decidedBy: { select: { name: true } } } });
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

      <Legend types={types} />
      <RosterGrid key={`${plan.id}-${plan.version}-${plan.status}`} planId={plan.id} editable={editable && plan.status !== "IN_REVIEW"} days={daysInMonth(`${month}-01`)} staff={staff}
        types={types.map(({ id, code, name, color }) => ({ id, code, name, color }))}
        shifts={Object.fromEntries(shifts.map((s) => [`${s.userId}|${s.date}`, s.shiftTypeId]))} flagged={flagged} />
      <p className="text-xs text-slate-500">Klick auf ein Feld wechselt den Dienst: {types.map((t) => `${t.code} ${fmtTime(t.startMin)}–${fmtTime(t.endMin)}`).join(" · ")} · frei.</p>

      {violations.length > 0 && (
        <div className="card border-rose-200">
          <h2 className="mb-2 text-sm font-semibold">Regelverstöße ({violations.length})</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{violations.map((v, i) => <li key={i}>{describeViolation(v, names, typeName)}</li>)}</ul>
        </div>
      )}
    </>
  );
}
