import Link from "next/link";
import { prisma, previewSwap, upcomingShifts } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { createSwapAction } from "@/app/actions";
import { fmtTime, WEEKDAYS, wd } from "@/lib/format";

const dmy = (d: string) => d.split("-").reverse().join(".");

export default async function NeuerTausch({ searchParams }: { searchParams: Promise<{ date?: string; with?: string; err?: string }> }) {
  const me = await requireUser(["EMPLOYEE"]);
  const sp = await searchParams;
  const mine = (await upcomingShifts(me.id, 60)).find((s) => s.date === sp.date);
  if (!mine) return <p className="card text-sm">Für diesen Tag ist kein tauschbarer Dienst veröffentlicht. <Link className="underline" href="/tausch">Zurück</Link></p>;

  const colleagues = await prisma.user.findMany({ where: { wardId: me.wardId, role: "EMPLOYEE", active: true, id: { not: me.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const partner = colleagues.find((c) => c.id === sp.with);
  const theirs = partner ? await upcomingShifts(partner.id, 60) : [];
  const handOverProblems = partner ? await previewSwap(me.id, { date: mine.date, partnerId: partner.id }) : [];
  const swapProblems = new Map(partner ? await Promise.all(theirs.map(async (s) => [s.date, await previewSwap(me.id, { date: mine.date, partnerId: partner.id, partnerDate: s.date })] as const)) : []);

  return (
    <>
      <h1 className="text-lg font-semibold">Dienst tauschen oder abgeben</h1>
      {sp.err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{sp.err}</p>}
      <div className="card text-sm"><b>{WEEKDAYS[wd(mine.date)]} {dmy(mine.date)}</b> · {mine.type.name} {fmtTime(mine.type.startMin)}–{fmtTime(mine.type.endMin)}</div>

      <form className="card flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="date" value={mine.date} />
        <label className="min-w-52 flex-1 text-xs font-medium">Mit wem?
          <select name="with" defaultValue={partner?.id ?? ""} className="input mt-1"><option value="">Allen anbieten (offen)</option>{colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="btn-ghost">Auswählen</button>
      </form>

      <form action={createSwapAction} className="card space-y-3">
        <input type="hidden" name="date" value={mine.date} />
        <input type="hidden" name="partner" value={partner?.id ?? ""} />
        {!partner && <p className="text-sm">Dein Dienst wird allen Kolleg:innen der Station angezeigt. Wer ihn übernimmt, muss die Ruhezeiten einhalten; danach gibt die Planung frei.</p>}
        {partner && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Was soll {partner.name} dir geben?</legend>
            <label className={`flex items-start gap-2 text-sm ${handOverProblems.length ? "opacity-50" : ""}`}>
              <input type="radio" name="partnerDate" value="none" defaultChecked={handOverProblems.length === 0} disabled={handOverProblems.length > 0} className="mt-1" />
              <span>Nichts – ich gebe den Dienst nur ab{handOverProblems.length > 0 && <span className="block text-rose-700">{handOverProblems.join("; ")}</span>}</span>
            </label>
            {theirs.map((s) => {
              const problems = swapProblems.get(s.date) ?? [];
              return (
                <label key={s.date} className={`flex items-start gap-2 text-sm ${problems.length ? "opacity-50" : ""}`}>
                  <input type="radio" name="partnerDate" value={s.date} disabled={problems.length > 0} className="mt-1" />
                  <span>{WEEKDAYS[wd(s.date)]} {dmy(s.date)} · {s.type.name} {fmtTime(s.type.startMin)}–{fmtTime(s.type.endMin)}{problems.length > 0 && <span className="block text-rose-700">{problems.join("; ")}</span>}</span>
                </label>
              );
            })}
          </fieldset>
        )}
        <label className="block text-xs font-medium">Nachricht <span className="font-normal text-slate-500">(optional)</span><input name="note" maxLength={300} className="input mt-1" /></label>
        <div className="flex gap-2"><button className="btn">Anfrage senden</button><Link className="btn-ghost" href="/tausch">Abbrechen</Link></div>
      </form>
    </>
  );
}
