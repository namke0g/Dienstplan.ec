import Link from "next/link";
import type { Role } from "@dienstplan/db";
import { LogoutButton } from "@/components/LogoutButton";

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", PLANNER: "Planer:in", PDL: "PDL", BETRIEBSRAT: "Betriebsrat", EMPLOYEE: "Mitarbeiter:in" };

export function Nav({ name, role, unread, openRequests = 0, openSwaps = 0 }: { name: string; role: Role; unread: number; openRequests?: number; openSwaps?: number }) {
  const links: [string, string][] =
    role === "PLANNER" || role === "ADMIN"
      ? [["/planer", "Planung"], ["/mein-plan", "Mein Plan"]]
      : role === "PDL" || role === "BETRIEBSRAT"
        ? [["/pruefung", "Prüfung"], ["/mein-plan", "Veröffentlichter Plan"]]
        : [["/mein-plan", "Mein Plan"]];
  links.push(["/urlaub", "Urlaub"]);
  if (role === "EMPLOYEE") links.push(["/tausch", openSwaps ? `Tausch (${openSwaps})` : "Tausch"]);
  if (role === "PLANNER" || role === "ADMIN" || role === "PDL") links.push(["/urlaubskonto", "Urlaubskonto"], ["/antraege", openRequests ? `Anträge (${openRequests})` : "Anträge"]);
  if (role === "ADMIN" || role === "PLANNER") links.push(["/benutzer", "Benutzer"]);
  links.push(["/kalender", "Kalender"], ["/benachrichtigungen", unread ? `Mitteilungen (${unread})` : "Mitteilungen"]);
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="font-semibold tracking-tight">Dienstplan</span>
        <nav className="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto sm:flex-1">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">{label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/konto" className="hidden text-slate-500 underline-offset-2 hover:underline sm:inline">{name} · {ROLE_LABEL[role]}</Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
