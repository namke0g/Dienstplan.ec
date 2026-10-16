/**
 * Operator CLI (run inside the "migrate" container, see DEPLOYMENT.md):
 *   bootstrap     --ward "Station 3A" --email admin@klinik.de --name "Vorname Nachname"
 *   create-user   --email x@klinik.de --name "Vorname Nachname" --role EMPLOYEE|PLANNER|PDL|BETRIEBSRAT|ADMIN
 *   reset-password --email x@klinik.de
 *   deactivate|activate --email x@klinik.de
 *   list-users
 * Passwords are generated and printed once unless the PASSWORD environment variable is set.
 */
import { AdminError, bootstrap, createUser, listUsers, prisma, resetPassword, setActive } from "../src";
import type { Role } from "@prisma/client";

const ROLES: Role[] = ["EMPLOYEE", "PLANNER", "PDL", "BETRIEBSRAT", "ADMIN"];
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const need = (name: string) => { const v = flag(name); if (!v) throw new AdminError(`--${name} fehlt`); return v; };
const password = process.env.PASSWORD || undefined;

async function main() {
  switch (cmd) {
    case "bootstrap": {
      const r = await bootstrap({ wardName: need("ward"), adminEmail: need("email"), adminName: need("name"), adminPassword: password });
      console.log(`Station "${r.ward.name}" und Admin ${r.admin.email} angelegt.`);
      if (r.password) console.log(`Einmaliges Passwort: ${r.password}\n(Bitte sicher notieren, es wird nicht noch einmal angezeigt.)`);
      break;
    }
    case "create-user": {
      const role = need("role").toUpperCase() as Role;
      if (!ROLES.includes(role)) throw new AdminError(`Rolle muss eine von ${ROLES.join(", ")} sein.`);
      const r = await createUser({ email: need("email"), name: need("name"), role, password });
      console.log(`${r.user.name} <${r.user.email}> (${r.user.role}) angelegt.`);
      if (r.password) console.log(`Einmaliges Passwort: ${r.password}`);
      break;
    }
    case "reset-password": {
      const r = await resetPassword(need("email"), password);
      console.log("Passwort gesetzt.");
      if (r.password) console.log(`Einmaliges Passwort: ${r.password}`);
      break;
    }
    case "deactivate": await setActive(need("email"), false); console.log("Konto deaktiviert (Anmeldung nicht mehr möglich, Daten bleiben erhalten)."); break;
    case "activate": await setActive(need("email"), true); console.log("Konto aktiviert."); break;
    case "list-users": for (const u of await listUsers()) console.log(`${u.active ? " " : "x"} ${u.role.padEnd(11)} ${u.email}  ${u.name}`); break;
    default:
      console.error("Befehle: bootstrap | create-user | reset-password | deactivate | activate | list-users"); process.exitCode = 2;
  }
}

main()
  .catch((e) => { console.error(e instanceof AdminError ? `Fehler: ${e.message}` : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
