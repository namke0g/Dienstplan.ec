# Dienstplan für Windows (Desktop-App)

Ein Installationsprogramm (`Dienstplan-Setup-….exe`), das die Web-App mit **eigener Datenbank** in einem Fenster startet. Es braucht weder Docker noch Node noch PostgreSQL.

## Installieren und starten
1. Die `.exe` aus dem GitHub-Lauf „Desktop (Windows)“ herunterladen (Actions → letzter Lauf → *Artifacts* → `Dienstplan-Setup`, ZIP entpacken).
2. Doppelklick. Windows meldet „Der Computer wurde durch Windows geschützt“, weil das Programm nicht signiert ist: *Weitere Informationen → Trotzdem ausführen*.
3. Dienstplan startet. Der erste Start dauert etwa eine halbe Minute (Datenbank wird angelegt und mit Demo-Daten gefüllt).

Demo-Logins, alle mit Passwort `demo1234`: `planer@demo.de`, `pdl@demo.de`, `br@demo.de`, `anna@demo.de` (Mitarbeiterin), `admin@demo.de`.

## Was wo liegt
- Daten (Datenbank, Einstellungen, Protokoll `dienstplan.log`): `%APPDATA%\Dienstplan` (Menü *Datei → Ordner mit den Daten öffnen*).
- Neu anfangen mit leeren Demo-Daten: Programm beenden, den Ordner `%APPDATA%\Dienstplan\data` löschen, neu starten.
- Beim Deinstallieren bleiben die Daten erhalten.

## Grenzen
- Die App läuft nur auf diesem PC (Adresse `http://127.0.0.1:38080`). Kolleg:innen, Handys, Push-Mitteilungen und Kalender-Abos von außen brauchen die Server-Variante ([DEPLOYMENT.md](../DEPLOYMENT.md)).
- Die Demo-Daten sind Beispieldaten. Für echte Personaldaten die Server-Variante mit Backups verwenden.
- Die Datenbank läuft nur, solange das Fenster offen ist.
- PostgreSQL verweigert den Start in einer als Administrator gestarteten Eingabeaufforderung/App: Dienstplan ganz normal starten.

## Selbst bauen (Entwicklung)
Im Repository-Wurzelverzeichnis:
```bash
pnpm install
pnpm --filter @dienstplan/db generate && pnpm --filter @dienstplan/web build
cd desktop
npm install
npm run prepare-app      # setzt desktop/build zusammen (Web-Server, Demo-Daten-Skript, Migrationen)
npm test                 # startet Datenbank + Web-Server unter Node und prüft Login-Seite und Demo-Daten (nicht als root)
npx electron . --smoke   # dasselbe im echten Fenster inkl. Anmeldung
npm run dist             # Windows-Installer (muss unter Windows laufen: der Prisma-Motor ist plattformabhängig)
```
Das Installationsprogramm entsteht in GitHub Actions (`.github/workflows/desktop.yml`) auf einem Windows-Rechner.

## Aufbau
- `src/backend.cjs` – startet PostgreSQL (npm-Paket `embedded-postgres`), spielt die SQL-Migrationen aus `packages/db/prisma/migrations` ein, legt beim allerersten Start die Demo-Daten an und startet den Next.js-Standalone-Server.
- `src/main.cjs` – Electron-Fenster, Menü, sauberes Beenden von Server und Datenbank.
- `scripts/prepare.mjs` – ordnet die `node_modules` des Standalone-Builds flach an (pnpm-Symlinks funktionieren unter Windows nicht ohne Adminrechte) und bündelt `seed.ts`.
