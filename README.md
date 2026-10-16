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
| Push-Benachrichtigungen iOS/Android (Expo → APNs/FCM): Plan veröffentlicht, Dienständerung (kurzfristig = hohe Priorität), Prüfung angefordert, Entscheidung | ✅ |
| Mobile App (Expo/React Native): Login, Mein Plan, Team, Mitteilungen, Kalender-Abo, Offline-Cache, Push an/aus | ✅ (noch nicht auf echtem Gerät getestet) |
| Web Push (PWA) | ⏳ später |
| Tauschbörse, Zeiterfassung, Druck/PDF, KIS/DATEV | ⏳ später |

## Aufbau
- `apps/web` – Next.js 15 (App Router), Tailwind 4, deutsche UI, responsive
- `packages/core` – Genehmigungs-Zustandsmaschine, Regelprüfung, ICS-Erzeugung (reine Logik, getestet)
- `apps/mobile` – Expo SDK 58 / React Native (eigenständiges npm-Projekt, nicht im pnpm-Workspace)
- `packages/db` – Prisma/PostgreSQL-Schema, Service-Schicht (Rollenprüfung, Audit-Log, Benachrichtigungen), Seed

Mitarbeitende sehen immer den **zuletzt veröffentlichten Snapshot**. Änderungen an einem veröffentlichten Plan erzeugen eine neue Version, die erst nach erneuter Genehmigung sichtbar wird.

## Lokal starten
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

## Mobile App & Push
```bash
cd apps/mobile && npm install
EXPO_PUBLIC_API_URL=https://dein-server.de npx expo start     # QR-Code mit Expo Go / Dev-Build öffnen
```
- `EXPO_PUBLIC_API_URL` zeigt auf die deployte Web-App (die App nutzt `/api/mobile/*` mit Bearer-Token).
- **Push braucht ein echtes Gerät und ein EAS-Projekt:** `npx eas init` → `EXPO_PUBLIC_EAS_PROJECT_ID` setzen. Für iOS (APNs) und Android (FCM) Zugangsdaten per `eas credentials` bzw. Firebase hinterlegen. Optional `EXPO_ACCESS_TOKEN` am Server (Expo „Enhanced Security“).
- Der Server sendet Pushes über `https://exp.host/--/api/v2/push/send` (`EXPO_PUSH_URL` überschreibbar). Nicht erreichbar → es wird beim nächsten Versand erneut versucht; abgemeldete Geräte-Token werden automatisch gelöscht.
- Bei Abmeldung wird das Gerät serverseitig ausgetragen und der lokale Cache gelöscht.
