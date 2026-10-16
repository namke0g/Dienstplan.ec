import { headers } from "next/headers";
import { prisma } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { regenerateCalendarAction } from "@/app/actions";
import { CopyButton } from "@/components/CopyButton";

export default async function KalenderPage() {
  const me = await requireUser();
  const tok = await prisma.calendarToken.findUnique({ where: { userId: me.id } });
  const host = (await headers()).get("host") ?? "localhost:3000";
  const path = tok ? `/api/cal/${tok.secret}` : null;
  const https = path ? `https://${host}${path}` : "";
  const webcal = path ? `webcal://${host}${path}` : "";

  return (
    <>
      <h1 className="text-lg font-semibold">Kalender-Abo</h1>
      <p className="max-w-prose text-sm text-slate-600 dark:text-slate-300">
        Abonniere deine Dienste in iPhone-/Apple-Kalender oder Google Kalender. Änderungen am veröffentlichten Plan erscheinen automatisch (Aktualisierung je nach App nach einigen Minuten bis Stunden). Persönliche Einträge werden <b>nicht</b> übertragen.
      </p>
      {!path ? <p className="card text-sm">Kein Link vorhanden.</p> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="font-semibold">iPhone / iPad / Mac</h2>
            <a className="btn" href={webcal}>In Apple Kalender abonnieren</a>
            <p className="text-xs text-slate-500">Ein Tipp öffnet den Kalender und fragt nach dem Abo.</p>
          </div>
          <div className="card space-y-3">
            <h2 className="font-semibold">Google Kalender</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Link kopieren.</li>
              <li><b>calendar.google.com im Browser</b> öffnen (die Google-Kalender-App kann keine Abos per URL hinzufügen).</li>
              <li>Links bei „Weitere Kalender“ auf <b>+</b> → <b>Per URL</b> → Link einfügen.</li>
            </ol>
            <CopyButton text={https} />
          </div>
        </div>
      )}
      <form action={regenerateCalendarAction} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>Link wurde weitergegeben oder ist verloren gegangen? Neuen Link erzeugen — der alte funktioniert dann nicht mehr.</span>
        <button className="btn-ghost">Neuen Link erzeugen</button>
      </form>
    </>
  );
}
