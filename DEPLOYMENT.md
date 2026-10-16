# Betrieb und Deployment

Anleitung für die Person, die Dienstplan auf einem eigenen Server in Betrieb nimmt. Alles läuft in Docker: PostgreSQL, die App, Caddy (automatisches HTTPS) und ein tägliches Backup.

```
Internet ──443──► Caddy ──► web (Next.js) ──► db (PostgreSQL, nicht von außen erreichbar)
                                   ▲                 ▲
                      migrate (einmalig)         backup (täglich → ./backups)
```

## 1. Voraussetzungen
- Linux-Server (empfohlen: Standort EU), 2 GB RAM, 10 GB Platz, Docker Engine mit Compose v2.
- Ein DNS-Eintrag (A/AAAA) für die gewünschte Adresse, z. B. `dienstplan.klinik.de`, der auf den Server zeigt.
- Ports 80 und 443 aus dem Internet erreichbar (für das Zertifikat von Let's Encrypt).

## 2. Erstinstallation
```bash
git clone https://github.com/namke0g/Dienstplan.ec.git dienstplan && cd dienstplan
cp .env.example .env
```
In `.env` eintragen: `DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD` (`openssl rand -hex 24`) und `SESSION_SECRET` (`openssl rand -hex 32`). `.env` nie committen; sichere eine Kopie der Datei getrennt vom Server (Passwortmanager).

```bash
docker compose up -d --build        # baut, migriert die Datenbank, startet alles
docker compose ps                   # web sollte "healthy" sein
```
**Ersten Admin anlegen** (nur einmal möglich, auf leerer Datenbank; legt Station und Standard-Dienstarten an, keine Demo-Daten):
```bash
docker compose run --rm migrate pnpm --filter @dienstplan/db admin bootstrap \
  --ward "Station 3A" --email admin@klinik.de --name "Vorname Nachname"
```
Das einmalige Passwort steht danach im Terminal. Anmelden unter `https://<DOMAIN>`.

## 3. Personen anlegen und verwalten
Es gibt noch **keine Benutzerverwaltung in der Oberfläche**; Konten legt ein Operator per Kommandozeile an:
```bash
A="docker compose run --rm migrate pnpm --filter @dienstplan/db admin"
$A create-user --email anna@klinik.de --name "Anna Becker" --role employee      # Passwort wird erzeugt und einmalig gezeigt
$A create-user --email planer@klinik.de --name "Petra Planer" --role planner    # planner | pdl | betriebsrat | employee | admin
$A reset-password --email anna@klinik.de
$A deactivate --email anna@klinik.de      # Austritt: Anmeldung gesperrt, Daten bleiben für den Dienstplan erhalten
$A list-users
```
Passwörter werden nur einmal angezeigt; gib sie persönlich weiter. **Jede Person soll es danach selbst ändern**: Web unter *Mein Konto* (Name oben rechts), App unter *Mehr → Passwort ändern*. Beim Ändern oder Zurücksetzen werden alle anderen Anmeldungen (Browser und App-Token) ungültig. Mit `PASSWORD=... ` vor dem Befehl kann ein eigenes (mind. 12 Zeichen) gesetzt werden. Danach als Planer:in unter *Urlaubskonto* den Jahresanspruch eintragen („Standardanspruch für alle“).

## 4. Mobile App (iOS und Android)
Die App ist ein Expo-Projekt (`apps/mobile`) und wird mit EAS gebaut; sie spricht mit deinem Server.
1. `cd apps/mobile && npm install && npx eas login && npx eas init` (erzeugt die Projekt-ID).
2. In `apps/mobile/eas.json` die Adresse bei `EXPO_PUBLIC_API_URL` auf `https://<DOMAIN>` setzen und die Projekt-ID als `EXPO_PUBLIC_EAS_PROJECT_ID` hinterlegen (`eas env:create` oder Umgebungsvariable beim Build).
3. **Push-Zugangsdaten** (ohne diese kommen keine Push-Nachrichten an):
   - iOS: Apple-Developer-Konto; `npx eas credentials` legt den APNs-Schlüssel an.
   - Android: Firebase-Projekt, FCM-V1-Service-Account-Schlüssel per `npx eas credentials` hochladen.
4. `npx eas build --platform all --profile preview` für interne Tests, `--profile production` und `eas submit` für die Stores.
5. Optional: Expo-Access-Token (Enhanced Push Security) als `EXPO_ACCESS_TOKEN` in `.env`.

## 5. Laufender Betrieb
| Aufgabe | Befehl |
|---|---|
| Status / Gesundheit | `docker compose ps` · `curl https://<DOMAIN>/api/health` (→ `{"status":"ok"}`) |
| Logs | `docker compose logs -f web` (`caddy`, `db`, `backup` analog) |
| Update | `git pull && docker compose up -d --build` (Migrationen laufen automatisch) |
| Neustart | `docker compose restart web` |
| Stoppen | `docker compose down` (Daten bleiben im Volume `dbdata`) |

Richte bei einem Uptime-Dienst eine Prüfung auf `https://<DOMAIN>/api/health` ein.

### Backups
Der Dienst `backup` schreibt täglich einen Dump nach `./backups` (Rechte nur für den Eigentümer) und löscht Dumps, die älter als `BACKUP_KEEP_DAYS` (Standard 14) sind. **Das ersetzt keine Offsite-Sicherung**: kopiere `./backups` regelmäßig auf einen anderen Ort (verschlüsselt, z. B. `restic`, `rclone` oder Snapshot des Servers). Manuelles Backup: `docker compose run --rm -e ONCE=1 backup`.

**Wiederherstellen** (ersetzt die aktuellen Daten!):
```bash
docker compose stop web
docker compose cp deploy/restore.sh db:/restore.sh && docker compose cp backups/dienstplan-2026-01-01-030000.dump db:/tmp/dump
docker compose exec db sh -c 'PGUSER=dienstplan PGDATABASE=dienstplan sh /restore.sh /tmp/dump'   # fragt nach dem Datenbanknamen
docker compose start web
```
**Teste die Wiederherstellung vor dem Echtbetrieb einmal** auf einem zweiten Server. Ein Backup, das nie zurückgespielt wurde, ist keine Sicherheit.

### Secrets wechseln
`SESSION_SECRET` ändern + `docker compose up -d web` meldet alle ab. Datenbankpasswort: im laufenden Container `ALTER USER dienstplan PASSWORD '…'` ausführen, dann `.env` anpassen und `docker compose up -d`.

## 6. Sicherheit und Datenschutz
**Eingebaut:** HTTPS mit HSTS, Sicherheits-Header, Passwörter mit bcrypt, Passwort ändern (invalidiert andere Sitzungen), begrenzte Anmeldeversuche (5 Fehlversuche je Konto und IP in 15 Minuten, 20 je IP), getrennte Tokens für Web und App, Krankheitsdaten für Kolleg:innen und Betriebsrat nur als „abwesend“, Audit-Protokoll der Planänderungen, Datenbank nur im internen Netz, Konfigurationsprüfung beim Start (die App startet nicht mit schwachem `SESSION_SECRET`).

**Das musst du als Betreiber regeln** (organisatorisch, nicht durch Software lösbar):
- Auftragsverarbeitungsvertrag, wenn ein externer Dienstleister hostet; Hosting in der EU.
- Verzeichnis der Verarbeitungstätigkeiten, ggf. Datenschutz-Folgenabschätzung (Beschäftigten- und Gesundheitsdaten, Art. 9 DSGVO).
- Dienstvereinbarung mit dem Betriebsrat (Mitbestimmung bei technischer Überwachung/Dienstplänen).
- Verschlüsselung der Server-Festplatte und der Offsite-Backups.
- Löschkonzept: Es gibt **noch kein Werkzeug zum Löschen oder Anonymisieren** ausgeschiedener Personen; „deactivate“ sperrt nur die Anmeldung.

## 7. Bekannte Grenzen
- Keine Benutzerverwaltung in der Oberfläche (Konten anlegen/sperren/zurücksetzen nur per CLI, siehe 3). Kein „Passwort vergessen“ per E-Mail (Operator setzt zurück). Keine Zwei-Faktor-Anmeldung.
- Die Anmeldebegrenzung liegt im Arbeitsspeicher einer Instanz (Neustart setzt sie zurück; mehrere Instanzen bräuchten einen gemeinsamen Speicher).
- Ein Server, eine Datenbank: keine Ausfallsicherheit. Feiertage sind im Urlaubskonto nicht berücksichtigt.

## 8. Wie dieses Setup geprüft wurde
- **Auf dem Entwicklungsrechner ohne Docker geprüft:** Produktions-Build ohne Datenbank, Start des Standalone-Servers (Gesundheitscheck, Anmeldung, Header, Abbruch mit Exit-Code 1 bei schwacher Konfiguration; die Browser-Tests laufen selbst gegen diesen Standalone-Server), Migration einer leeren Datenbank von null, Bootstrap/CLI, Anmeldebegrenzung, Backup, Aufbewahrung, Fehlerfall und Wiederherstellung (Zeilenzahlen und Passwort-Hash identisch), Validierung der Compose-Datei.
- **Nur in der CI geprüft (`.github/workflows/ci.yml`, Job `docker`):** Bau der Images, Start des Stacks im Container, Gesundheitscheck im Container, CLI und Backup im Container. Caddy/Let's Encrypt wird nur auf einem echten Server mit DNS getestet. **Führe nach dem ersten Deployment die Checkliste unten aus.**

### Checkliste nach dem ersten Deployment
- [ ] `https://<DOMAIN>` lädt mit gültigem Zertifikat; `http://` leitet um.
- [ ] `docker compose ps`: `web` und `db` healthy; `curl https://<DOMAIN>/api/health` → ok.
- [ ] Anmeldung als Admin funktioniert; Planer:in, PDL, Betriebsrat und eine Mitarbeiterin angelegt.
- [ ] Testplan durchlaufen: einreichen → PDL und Betriebsrat genehmigen → veröffentlichen → Mitarbeiterin sieht ihn.
- [ ] `docker compose run --rm -e ONCE=1 backup` erzeugt einen Dump; Wiederherstellung einmal getestet.
- [ ] App auf einem echten iPhone und Android-Gerät: Anmeldung, Push nach „Veröffentlichen“, Kalender-Abo.
