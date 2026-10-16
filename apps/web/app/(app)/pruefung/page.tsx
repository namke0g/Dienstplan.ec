import { prisma, daysInMonth, toYmd } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { ABSENT_TYPE, canSeeSick, describeViolation, draftShifts, maskSick, toGridTypes, violationsFor, wardContext } from "@/lib/roster";
import { monthLabel } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Legend, RosterGrid } from "@/components/RosterGrid";
import { reviewAction } from "@/app/actions";

export default async function PruefungPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const err = (await searchParams).err;
  const me = await requireUser(["PDL", "BETRIEBSRAT"]);
  const { staff, types } = await wardContext(me.wardId);
  const plans = await prisma.plan.findMany({ where: { wardId: me.wardId, status: { in: ["IN_REVIEW", "CHANGES_REQUESTED", "APPROVED"] } }, orderBy: { month: "asc" }, include: { approvals: true } });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const gridTypes = canSeeSick(me.role) ? toGridTypes(types) : [...toGridTypes(types.filter((t) => t.kind !== "SICK")), ABSENT_TYPE];

  return (
    <>
      <h1 className="text-lg font-semibold">Zur Prüfung · {me.role === "PDL" ? "PDL" : "Betriebsrat"}</h1>
      {err === "comment" && <p role="alert" className="card border-rose-300 text-sm text-rose-700">Bitte gib einen Kommentar an, wenn du einen Plan ablehnst.</p>}
      {plans.length === 0 && <p className="card text-sm text-slate-500">Keine Pläne zur Prüfung.</p>}
      {await Promise.all(plans.map(async (p) => {
        const month = toYmd(p.month).slice(0, 7);
        const all = await draftShifts(p.id);
        const violations = violationsFor(all, types);
        const shifts = maskSick(all, types, me.id, canSeeSick(me.role));
        const mine = p.approvals.find((a) => a.version === p.version && a.role === me.role);
        const canDecide = p.status === "IN_REVIEW" && mine?.decision === "PENDING";
        return (
          <section key={p.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold capitalize">{monthLabel(month)}</h2><StatusBadge status={p.status} /><span className="text-xs text-slate-500">Version {p.version}</span>
              {mine && mine.decision !== "PENDING" && <span className="text-sm">Deine Entscheidung: {mine.decision === "APPROVED" ? "✅ genehmigt" : "❌ abgelehnt"}</span>}
            </div>
            <Legend types={gridTypes} />
            <RosterGrid editable={false} days={daysInMonth(`${month}-01`)} staff={staff} types={gridTypes}
              shifts={Object.fromEntries(shifts.map((s) => [`${s.userId}|${s.date}`, s.shiftTypeId]))}
              flagged={violations.flatMap((v) => ("userId" in v ? [`${v.userId}|${v.date}`] : []))} />
            {violations.length > 0 && (
              <div className="card text-sm"><b>Regelverstöße ({violations.length})</b>
                <ul className="mt-1 list-disc pl-5">{violations.map((v, i) => <li key={i}>{describeViolation(v, names, typeName)}</li>)}</ul></div>
            )}
            {canDecide && (
              <form className="card space-y-3">
                <label className="block text-sm font-medium">Kommentar (bei Ablehnung Pflicht)
                  <textarea name="comment" rows={2} className="input mt-1" /></label>
                <div className="flex gap-2">
                  <button className="btn" formAction={reviewAction.bind(null, p.id, "APPROVED")}>Genehmigen</button>
                  <button className="btn-ghost !border-rose-300 !text-rose-700" formAction={reviewAction.bind(null, p.id, "REJECTED")}>Ablehnen</button>
                </div>
              </form>
            )}
          </section>
        );
      }))}
    </>
  );
}
