import { listManagedUsers } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { CreateUserForm, ResetPasswordForm } from "@/components/UserForms";
import { anonymizeUserAction, setUserActiveAction, updateUserAction } from "@/app/actions";

const ROLE_LABEL: Record<string, string> = { EMPLOYEE: "Mitarbeiter:in", PLANNER: "Planer:in", PDL: "PDL", BETRIEBSRAT: "Betriebsrat", ADMIN: "Admin" };

export default async function Benutzer({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const viewer = await requireUser(["ADMIN", "PLANNER"]);
  const { err, ok } = await searchParams;
  const { users, roles } = await listManagedUsers(viewer.id);
  const isAdmin = viewer.role === "ADMIN";

  return (
    <>
      <h1 className="text-lg font-semibold">Benutzer</h1>
      {!isAdmin && <p className="text-sm text-slate-500">Als Planer:in verwaltest du die Konten der Mitarbeitenden. Weitere Rollen vergibt ein Admin.</p>}
      {err && <p role="alert" className="card border-rose-300 text-sm text-rose-700">{err}</p>}
      {ok && <p role="status" className="card border-emerald-300 text-sm text-emerald-700">{ok}</p>}

      <CreateUserForm roles={roles} />

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr>{["Name", "E-Mail", "Rolle", "Status", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === viewer.id;
              return (
                <tr key={u.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <th className="p-3 text-left font-medium">{u.name}{self && <span className="ml-1 text-xs font-normal text-slate-400">(du)</span>}</th>
                  <td className="p-3">{u.anonymizedAt ? <span className="text-slate-400">–</span> : u.email}</td>
                  <td className="p-3">{ROLE_LABEL[u.role]}</td>
                  <td className="p-3">{u.anonymizedAt ? <span className="text-slate-500">anonymisiert</span> : u.active ? <span className="text-emerald-700">aktiv</span> : <span className="text-slate-500">deaktiviert</span>}</td>
                  <td className="p-3">
                    {!u.anonymizedAt && (
                      <details>
                        <summary className="cursor-pointer text-xs underline" aria-label={`Verwalten ${u.name}`}>Verwalten</summary>
                        <div className="mt-2 w-80 max-w-full space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                          <form action={updateUserAction.bind(null, u.id)} className="grid gap-2" aria-label={`Bearbeiten ${u.name}`}>
                            <label className="text-xs">Name<input name="name" defaultValue={u.name} required className="input mt-1" /></label>
                            <label className="text-xs">E-Mail<input name="email" type="email" defaultValue={u.email} required className="input mt-1" /></label>
                            {isAdmin && !self && <label className="text-xs">Rolle<select name="role" defaultValue={u.role} className="input mt-1">{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>}
                            <button className="btn">Speichern</button>
                          </form>
                          {!self && <ResetPasswordForm userId={u.id} name={u.name} email={u.email} />}
                          {!self && (u.active
                            ? <form action={setUserActiveAction.bind(null, u.id, false)}><button className="btn-ghost !border-rose-300 !py-1 !text-rose-700">Deaktivieren</button><p className="mt-1 text-xs text-slate-500">Meldet die Person überall ab, stoppt Push und zieht offene Anträge zurück. Der Dienstplan-Verlauf bleibt.</p></form>
                            : <form action={setUserActiveAction.bind(null, u.id, true)}><button className="btn-ghost !py-1">Wieder aktivieren</button></form>)}
                          {isAdmin && !self && !u.active && (
                            <form action={anonymizeUserAction.bind(null, u.id)} className="space-y-1 rounded-lg bg-rose-50 p-2 dark:bg-rose-950" aria-label={`Anonymisieren ${u.name}`}>
                              <p className="text-xs text-rose-900 dark:text-rose-100"><b>Anonymisieren</b> löscht Name, E-Mail, Zugang, private Einträge und Geräte <b>unwiderruflich</b>. Dienste im Plan bleiben als „Ehemalige Person“.</p>
                              <input type="hidden" name="expected" value={u.email} />
                              <label className="text-xs">Zur Bestätigung E-Mail eingeben<input name="confirm" autoComplete="off" className="input mt-1" /></label>
                              <button className="btn-ghost !border-rose-400 !py-1 !text-rose-700">Endgültig anonymisieren</button>
                            </form>
                          )}
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
