import { localToday } from "@dienstplan/core";
import { getPreference, myWishes, prisma } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { MonthNav } from "@/components/MonthNav";
import { monthParam, shiftMonth } from "@/lib/format";
import { deleteWishAction, savePreferenceAction, setWishAction } from "@/app/actions";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const label = (d: string) => `${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}.`;
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

export default async function WuenschePage({ searchParams }: { searchParams: Promise<{ m?: string; err?: string; ok?: string }> }) {
  const me = await requireUser(["EMPLOYEE"]);
  const sp = await searchParams;
  const month = sp.m ? monthParam(sp.m) : shiftMonth(localToday().slice(0, 7), 1); // wishes are for the months ahead
  const [mine, pref, work] = await Promise.all([
    myWishes(me.id, month), getPreference(me.id),
    prisma.shiftType.findMany({ where: { wardId: me.wardId, kind: "WORK" }, orderBy: { startMin: "asc" } }),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav base="/wuensche" month={month} />
        <span className="text-sm text-slate-500">Wunschfrei: noch {mine.freeLeft} von {mine.freeLimit}</span>
      </div>
      {sp.err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{sp.err}</p>}
      {sp.ok && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">{sp.ok}</p>}

      {mine.closed ? <p className="card text-sm text-slate-500">{mine.closed}</p> : (
        <form action={setWishAction.bind(null, month)} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Wunsch eintragen">
          <label className="text-xs font-medium">Tag<input type="date" name="date" required min={`${month}-01`} max={lastDay(month)} defaultValue={`${month}-01`} className="input mt-1" /></label>
          <label className="text-xs font-medium">Wunsch
            <select name="wish" className="input mt-1">
              <option value="FREE">Wunschfrei</option>
              {work.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
          <label className="text-xs font-medium">Anmerkung <span className="font-normal text-slate-500">(optional, nur für die Planung)</span><input name="note" maxLength={200} className="input mt-1" /></label>
          <div className="flex items-end"><button className="btn w-full">Wunsch speichern</button></div>
        </form>
      )}

      <h2 className="font-semibold">Meine Wünsche</h2>
      {mine.wishes.length === 0 && <p className="card text-sm text-slate-500">Keine Wünsche für diesen Monat.</p>}
      <ul className="space-y-2">
        {mine.wishes.map((w) => (
          <li key={w.id} className="card flex flex-wrap items-center justify-between gap-2 text-sm" aria-label={`Wunsch ${label(w.date)}`}>
            <span><b>{label(w.date)}</b> · {w.kind === "FREE" ? "Wunschfrei" : w.shiftType?.name}{w.note && <span className="text-slate-500"> – „{w.note}“</span>}</span>
            {!mine.closed && <form action={deleteWishAction.bind(null, w.id, month)}><button className="btn-ghost !py-1">Löschen</button></form>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Wünsche sind Hinweise für die Planung, kein Anspruch. Kolleg:innen, PDL und Betriebsrat sehen sie nicht. Wünsche gehen bis zur Einreichung des Plans zur Genehmigung.</p>

      <form action={savePreferenceAction} className="card space-y-3" aria-label="Dauerhafte Vorlieben">
        <h2 className="font-semibold">Dauerhafte Vorlieben</h2>
        <input type="hidden" name="m" value={month} />
        <table className="text-sm">
          <thead><tr><th className="pr-4 text-left font-medium">Dienst</th><th className="px-3 font-medium">gern</th><th className="px-3 font-medium">möglichst nicht</th><th className="px-3 font-medium">egal</th></tr></thead>
          <tbody>
            {work.map((t) => {
              const cur = pref.prefer.includes(t.id) ? "prefer" : pref.avoid.includes(t.id) ? "avoid" : "any";
              return (
                <tr key={t.id}>
                  <td className="pr-4">{t.name}</td>
                  {(["prefer", "avoid", "any"] as const).map((v) => (
                    <td key={v} className="px-3 text-center"><input type="radio" name={`p_${t.id}`} value={v} defaultChecked={cur === v} aria-label={`${t.name}: ${v === "prefer" ? "gern" : v === "avoid" ? "möglichst nicht" : "egal"}`} /></td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="block text-xs font-medium">Hinweis für die Planung <span className="font-normal text-slate-500">(z. B. „Kinderbetreuung bis 15 Uhr“)</span><input name="note" maxLength={300} defaultValue={pref.note ?? ""} className="input mt-1" /></label>
        <button className="btn">Vorlieben speichern</button>
      </form>
    </>
  );
}
