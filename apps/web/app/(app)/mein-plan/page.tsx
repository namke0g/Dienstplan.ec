import { prisma, toDate, toYmd, daysInMonth } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { ABSENT_TYPE, canSeeSick, maskSick, monthHolidays, snapshotOf, toGridTypes, wardContext, planFor } from "@/lib/roster";
import { fmtTime, monthParam, WEEKDAYS, wd, isWeekend, STATUS_LABEL } from "@/lib/format";
import { MonthNav } from "@/components/MonthNav";
import { Legend, RosterGrid } from "@/components/RosterGrid";
import { addPersonalAction, deletePersonalAction } from "@/app/actions";

export default async function MeinPlanPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requireUser();
  const month = monthParam((await searchParams).m);
  const days = daysInMonth(`${month}-01`);
  const { staff, types } = await wardContext(me.wardId, [month]);
  const holidays = await monthHolidays(me.wardId, month);
  const plan = await planFor(me.wardId, month);
  const published = plan?.publishedSnapshot != null;
  const allShifts = snapshotOf(plan);
  const shifts = maskSick(allShifts, types, me.id, canSeeSick(me.role));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const mine = new Map(shifts.filter((s) => s.userId === me.id).map((s) => [s.date, typeById.get(s.shiftTypeId)!]));
  const workMine = [...mine.values()].filter((t) => t.kind === "WORK");
  const absMine = [...mine.values()].filter((t) => t.kind !== "WORK");
  const entries = await prisma.personalEntry.findMany({
    where: { userId: me.id, date: { gte: toDate(`${month}-01`), lte: toDate(days[days.length - 1]!) } }, orderBy: { date: "asc" },
  });
  const entriesByDay = Map.groupBy(entries, (e) => toYmd(e.date));
  const pending = plan && published && plan.version !== plan.publishedVersion;
  const hours = workMine.reduce((sum, t) => sum + (((t.endMin <= t.startMin ? t.endMin + 1440 : t.endMin) - t.startMin) / 60), 0);
  const gridTypes = canSeeSick(me.role) ? toGridTypes(types) : [...toGridTypes(types.filter((t) => t.kind !== "SICK")), ABSENT_TYPE];
  const absSummary = Object.entries(Object.groupBy(absMine, (t) => t.name)).map(([n, l]) => `${l!.length} × ${n}`).join(" · ");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav base="/mein-plan" month={month} />
        {published && plan?.publishedAt && (
          <span className="text-xs text-slate-500">Veröffentlicht am {plan.publishedAt.toLocaleDateString("de-DE")} · Version {plan.publishedVersion}</span>
        )}
      </div>

      {!published && <p className="card text-sm text-slate-500">Für diesen Monat ist noch kein Dienstplan veröffentlicht{plan ? ` (Status: ${STATUS_LABEL[plan.status]})` : ""}. Du bekommst eine Mitteilung, sobald er online ist.</p>}
      {pending && <p className="card border-amber-300 text-sm">Es gibt eine neuere Planversion in Prüfung. Angezeigt wird die zuletzt veröffentlichte Version.</p>}

      {published && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card"><div className="text-xs text-slate-500">Meine Dienste</div><div className="text-2xl font-semibold">{workMine.length}</div>{absSummary && <div className="mt-1 text-xs text-slate-500">{absSummary}</div>}</div>
            <div className="card"><div className="text-xs text-slate-500">Geplante Stunden (brutto)</div><div className="text-2xl font-semibold">{hours.toFixed(1).replace(".0", "")} h</div></div>
            <div className="card"><div className="text-xs text-slate-500">Nächster Dienst</div>
              <div className="text-lg font-semibold">{(() => { const today = new Date().toISOString().slice(0, 10); const n = [...mine.keys()].sort().find((d) => d >= today && mine.get(d)!.kind === "WORK"); const t = n && mine.get(n); return n && t ? `${n.slice(8)}.${n.slice(5, 7)}. ${t.name}` : "–"; })()}</div></div>
          </div>

          <section className="space-y-2">
            <h2 className="font-semibold">Mein Monat</h2>
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {days.map((d) => {
                const t = mine.get(d); const es = entriesByDay.get(d) ?? [];
                if (!t && es.length === 0) return null;
                return (
                  <li key={d} className={`card flex items-start gap-3 !p-3 ${isWeekend(d) ? "bg-slate-50" : ""}`}>
                    <div className="w-10 text-center"><div className="text-xs text-slate-500">{WEEKDAYS[wd(d)]}</div><div className="font-semibold">{d.slice(8)}</div></div>
                    <div className="flex-1 space-y-1 text-sm">
                      {holidays[d] && <div className="text-xs font-medium text-rose-700 dark:text-rose-300">Feiertag: {holidays[d]}</div>}
                      {t && <div className="inline-flex items-center gap-2 rounded-lg px-2 py-0.5 text-white" style={{ background: t.color }}>{t.name} <span className="opacity-80">{t.kind === "WORK" ? `${fmtTime(t.startMin)}–${fmtTime(t.endMin)}` : t.paid ? "bezahlt" : "unbezahlt"}</span></div>}
                      {es.map((e) => (
                        <form key={e.id} action={deletePersonalAction.bind(null, e.id)} className="flex items-center justify-between gap-2 rounded-lg bg-violet-50 px-2 py-0.5 text-violet-900 dark:bg-violet-950 dark:text-violet-100">
                          <span>📝 {e.title}{e.note ? ` – ${e.note}` : ""}</span><button className="text-xs underline" aria-label="Eintrag löschen">löschen</button>
                        </form>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <form action={addPersonalAction} className="card flex flex-wrap items-end gap-2">
            <div className="w-full text-sm font-semibold">Eigenen Eintrag hinzufügen <span className="font-normal text-slate-500">(nur für dich sichtbar)</span></div>
            <label className="text-xs">Datum<input type="date" name="date" required defaultValue={`${month}-01`} className="input mt-1" /></label>
            <label className="min-w-40 flex-1 text-xs">Titel<input name="title" required maxLength={120} placeholder="z. B. Arzttermin" className="input mt-1" /></label>
            <label className="min-w-40 flex-1 text-xs">Notiz<input name="note" maxLength={500} className="input mt-1" /></label>
            <button className="btn">Hinzufügen</button>
          </form>

          <section className="space-y-2">
            <h2 className="font-semibold">Team</h2>
            <Legend types={gridTypes} />
            <RosterGrid editable={false} days={days} staff={staff} types={gridTypes} highlightUser={me.id} holidays={holidays}
              shifts={Object.fromEntries(shifts.map((s) => [`${s.userId}|${s.date}`, s.shiftTypeId]))} />
          </section>
        </>
      )}
    </>
  );
}
