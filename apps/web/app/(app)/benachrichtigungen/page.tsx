import { prisma, vapidConfig, webPushConfigured } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { markAllReadAction } from "@/app/actions";
import { PushToggle } from "@/components/PushToggle";
import { BrowserPushToggle } from "@/components/BrowserPushToggle";

export default async function Page() {
  const me = await requireUser();
  const items = await prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mitteilungen</h1>
        <form action={markAllReadAction}><button className="btn-ghost">Alle als gelesen markieren</button></form>
      </div>
      <PushToggle initial={me.pushEnabled} />
      {webPushConfigured() && <BrowserPushToggle publicKey={vapidConfig().publicKey} />}
      {items.length === 0 && <p className="card text-sm text-slate-500">Noch keine Mitteilungen.</p>}
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className={`card ${n.readAt ? "opacity-70" : ""} ${n.shortNotice ? "border-rose-300" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <b className="text-sm">{n.shortNotice && "⚠️ "}{n.title}</b>
              <span className="text-xs text-slate-500">{n.createdAt.toLocaleString("de-DE")}</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">{n.body}</p>
            <p className="mt-1 text-xs text-slate-400">{n.deliveredAt ? `Push zugestellt ${n.deliveredAt.toLocaleTimeString("de-DE")}` : "Nur im Portal"}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
