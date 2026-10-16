# Änderungen

## [0.1.0] - 2026-10-16

Erste Testversion. Zum Ausprobieren und für Rückmeldungen – noch nicht für den Echtbetrieb freigegeben.

**Ausprobieren:** `docker compose -f docker-compose.demo.yml up --build`, dann http://localhost:3000 öffnen (Demo-Logins mit Passwort `demo1234`: `planer@demo.de`, `pdl@demo.de`, `br@demo.de`, `anna@demo.de`, `admin@demo.de`). Details im README unter „Testen“.

### Dienstplanung
- Planungsraster je Monat mit Regelprüfung (11 h Ruhezeit, max. 6 Tage am Stück, Mindestbesetzung), Feiertage je Bundesland und örtliche freie Tage
- Genehmigung durch PDL und Betriebsrat parallel; erst danach geht der Plan online. Ablehnung nur mit Begründung, jede spätere Änderung wird eine neue Version mit erneuter Genehmigung
- Mitarbeitende sehen immer den zuletzt veröffentlichten Stand

### Für Mitarbeitende
- Mein Plan, Teamansicht, private persönliche Einträge
- Kalender-Abo für iPhone/Mac und Google Kalender (Änderungen werden übernommen, keine Duplikate)
- Urlaub, unbezahlter Urlaub und Sonderurlaub beantragen; Urlaubskonto mit Übertrag und Verfall
- Genehmigten Urlaub zurückgeben (mit Zustimmung der Planung)
- Krank melden, verlängern, früher gesund melden
- Diensttausch und Dienstabgabe, mit Regelprüfung und Freigabe durch die Planung
- Wünsche: Wunschfrei und Wunschdienste für kommende Monate, dauerhafte Vorlieben
- Mitteilungen im Portal, auf Wunsch auch als Push im Browser

### Für Planung, PDL und Verwaltung
- Anträge, Tausch und Rückgaben an einer Stelle; Krankmeldungen mit Liste der ausfallenden Dienste
- Wünsche und Vorlieben im Planungsraster („x von y erfüllt“)
- Urlaubskonten der Station, Jahreswechsel
- Benutzerverwaltung (anlegen mit Einmal-Passwort, Rollen, deaktivieren, anonymisieren), Stationseinstellungen
- Datenschutz: Krankheit sehen nur die Person, Planung und PDL (alle anderen: „abwesend“); Wünsche nur die Planung

### Betrieb
- Docker-Compose-Stack mit PostgreSQL, automatischem HTTPS (Caddy) und täglichen Backups; Anleitung in DEPLOYMENT.md
- Docker-Images: `ghcr.io/namke0g/dienstplan.ec/web` und `ghcr.io/namke0g/dienstplan.ec/migrate`

### Bekannte Einschränkungen
- Für den PC gemacht; im Handy-Browser nutzbar, eine eigene Handy-App gibt es nicht
- Push im Browser braucht einen Server mit HTTPS und VAPID-Schlüsseln (in der Demo aus); die Mitteilungen im Portal funktionieren immer
- Nicht enthalten: Zeiterfassung, Druck/PDF, Schnittstellen zu KIS oder DATEV
