# Dienstplan

Dienstplanung für Stationen: Der Plan wird von der Planung erstellt und geht erst online, nachdem **PDL und Betriebsrat** ihn genehmigt haben. Mitarbeitende sehen ihren Plan im Portal, führen einen privaten persönlichen Plan und abonnieren ihre Dienste in Apple/Google Kalender.

## Stand (MVP)
| Bereich | Status |
|---|---|
| Planungsraster, Regelprüfung (11 h Ruhezeit, max. 6 Tage am Stück, Mindestbesetzung) | ✅ |
| Genehmigung PDL + Betriebsrat (parallel, Ablehnung nur mit Kommentar, Neuversion nach Änderung) | ✅ |
| Mitarbeiterportal: veröffentlichter Plan, Teamansicht, persönliche Einträge | ✅ |
| Abwesenheiten: Urlaub, unbezahlter Urlaub, Krank mit/ohne Entgelt, Sonderurlaub (zählen nicht als Arbeitstage/Besetzung; Krankheit für Kolleg:innen nur als „abwesend“) | ✅ |
| Kalender-Abo (ICS, stabile UIDs, widerrufbarer Link) für iOS & Google | ✅ |
| In-App-Mitteilungen (Plan veröffentlicht / Dienst geändert, Kurzfristig-Markierung) | ✅ |
| Urlaubs-/Abwesenheitsanträge (Urlaub, unbezahlt, Sonderurlaub): Mitarbeitende beantragen im Portal, Planung oder PDL entscheidet; genehmigt wird automatisch in den Dienstplan geschrieben | ✅ |
| Diensttausch: Angebot an alle oder Tausch/Abgabe an eine Kollegin/einen Kollegen (auch am selben Tag); Regelprüfung (Ruhezeit, Arbeitstage) vorab und bei Freigabe; Planung gibt frei, der veröffentlichte Plan wird direkt geändert (keine erneute PDL/Betriebsrat-Genehmigung), Audit-Log | ✅ |
| Urlaubskonto: Jahresanspruch, Übertrag mit Verfallsdatum, Korrektur; genommen/geplant aus dem Dienstplan, offene Anträge werden mitgezählt, Anträge über dem Rest werden abgelehnt, Jahreswechsel-Übernahme, Anzeige im Portal | ✅ |
| Betrieb: Docker-Compose-Stack (Postgres, App, HTTPS-Proxy, Backups), Health-Check, Anmeldebegrenzung, Passwort ändern, Bootstrap-/Benutzer-CLI, CI | ✅ siehe [DEPLOYMENT.md](DEPLOYMENT.md) |
| Benutzerverwaltung (Admin/Planung): anlegen mit Einmal-Passwort, Rolle ändern, Passwort zurücksetzen, deaktivieren, anonymisieren; Rollengrenzen, Schutz des letzten Admins, Protokoll | ✅ |
| Browser-Push (Web Push, VAPID): allgemeiner Text für geteilte Bildschirme, Austragen beim Abmelden, Wiederholung bei Ausfall | ✅ |
| Feiertage je Bundesland (inkl. Ostertermine, Änderungen seit 2017) und örtliche freie Tage: im Dienstplan markiert, im Urlaubskonto nicht abgezogen | ✅ |
| Krankmeldung (im Portal, oder durch die Planung nach Anruf): sofort im Plan, Planung erfährt, welche Dienste ausfallen; verlängern, früher gesund (geplante Dienste kommen zurück), zurücknehmen; Urlaubstage werden zurückgebucht | ✅ |
| Genehmigten Urlaub zurückgeben (Antrag mit Grund, Zustimmung durch Planung/PDL; Tage werden im Plan frei und zurückgebucht) | ✅ |
| Dienstwünsche (Wunschfrei, Wunschdienst) und dauerhafte Vorlieben; im Planungsraster markiert, „x von y erfüllt“, nur für die Planung sichtbar | ✅ |
| Zeiterfassung, Druck/PDF, KIS/DATEV | ⏳ später |

## Aufbau
- `apps/web` – Next.js 15 (App Router), Tailwind 4, deutsche UI, responsive
- `packages/core` – Genehmigungs-Zustandsmaschine, Regelprüfung, ICS-Erzeugung (reine Logik, getestet)
- `packages/db` – Prisma/PostgreSQL-Schema, Service-Schicht (Rollenprüfung, Audit-Log, Benachrichtigungen), Seed

Mitarbeitende sehen immer den **zuletzt veröffentlichten Snapshot**. Änderungen an einem veröffentlichten Plan erzeugen eine neue Version, die erst nach erneuter Genehmigung sichtbar wird.

**Betrieb auf einem Server (Docker, HTTPS, Backups): siehe [DEPLOYMENT.md](DEPLOYMENT.md).**

## Testen (Version 0.1.0)
Die schnellste Art, alles auszuprobieren – nur [Docker](https://docs.docker.com/get-docker/) wird gebraucht:
```bash
git clone https://github.com/namke0g/Dienstplan.ec.git && cd Dienstplan.ec
docker compose -f docker-compose.demo.yml up --build
```
Dann **http://localhost:3000** öffnen. Alle Demo-Konten haben das Passwort `demo1234`:

| Konto | Rolle | Ausprobieren |
|---|---|---|
| `planer@demo.de` | Planung | Plan bearbeiten, einreichen, veröffentlichen; Anträge, Tausch, Krankmeldungen, Wünsche |
| `pdl@demo.de` | PDL | Plan prüfen und genehmigen, Anträge entscheiden |
| `br@demo.de` | Betriebsrat | Plan prüfen und genehmigen |
| `anna@demo.de` (auch `ben@`, `clara@` …) | Mitarbeiterin | Mein Plan, Urlaub, Tausch, Wünsche, Krank melden, Kalender-Abo |
| `admin@demo.de` | Admin | Benutzer, Stationseinstellungen (Bundesland, Wunschfrei-Grenze) |

Neu anfangen (Demo-Daten zurücksetzen): `docker compose -f docker-compose.demo.yml down -v`.

**Am Handy oder Tablet:** Die Seite ist für den PC gemacht, funktioniert aber auch im Handy-Browser. Gerät ins selbe WLAN wie der Rechner und `http://<IP des Rechners>:3000` öffnen (die IP zeigt z. B. `ipconfig` unter Windows bzw. `ipconfig getifaddr en0` auf dem Mac).

**Mitteilungen:** In der Demo erscheinen sie im Portal unter „Mitteilungen“. Push im Browser braucht einen Server mit HTTPS und Schlüsseln (siehe DEPLOYMENT.md) – in der Demo ist das ausgeschaltet.

Was sich geändert hat: [CHANGELOG.md](CHANGELOG.md). Der Echtbetrieb auf einem Server ist in [DEPLOYMENT.md](DEPLOYMENT.md) beschrieben.

## Lokal starten (Entwicklung)
```bash
pnpm install
cp packages/db/.env.example packages/db/.env      # DATABASE_URL anpassen
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @dienstplan/db migrate               # Schema anlegen
pnpm --filter @dienstplan/db seed                  # Demo-Daten (Passwort: demo1234)
pnpm --filter @dienstplan/web dev
```
Demo-Logins: `planer@demo.de`, `pdl@demo.de`, `br@demo.de`, `anna@demo.de` (Mitarbeiterin).
In Produktion ist `SESSION_SECRET` Pflicht (`openssl rand -hex 32`).

## Tests
```bash
pnpm test                          # core + DB-Workflow (benötigt PostgreSQL)
pnpm --filter @dienstplan/web build && pnpm --filter @dienstplan/web e2e   # Browser-E2E
```

