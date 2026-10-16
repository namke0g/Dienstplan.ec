// Starts the real backend (embedded Postgres + migrations + demo data + web server) under plain Node, checks that
// a demo user can be read from the database and the login page is served, restarts it and checks the data survived.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const { start } = require("../src/backend.cjs");
const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "dienstplan-desktop-"));
const opts = { dataDir, appDir: path.join(desktop, "build/app"), migrationsDir: path.join(desktop, "build/migrations"), log: (m) => console.log("  ·", m) };

const fail = (m) => { console.error("FEHLER:", m); process.exit(1); };
const check = async (b, label) => {
  const health = await (await fetch(`${b.url}/api/health`)).json();
  if (health.status !== "ok") fail(`${label}: /api/health = ${JSON.stringify(health)}`);
  const login = await fetch(`${b.url}/login`);
  if (!login.ok || !(await login.text()).includes("Anmelden")) fail(`${label}: Login-Seite nicht ausgeliefert (${login.status})`);
  const c = new pg.Client({ connectionString: b.databaseUrl });
  await c.connect();
  const n = (await c.query(`SELECT count(*)::int n FROM "User" WHERE email='planer@demo.de'`)).rows[0].n;
  await c.end();
  if (n !== 1) fail(`${label}: Demo-Benutzer planer@demo.de fehlt`);
  console.log(`✓ ${label}: ${b.url} (Health ok, Login-Seite, Demo-Daten)`);
};

console.log("1. Erststart");
let b = await start(opts);
await check(b, "Erststart");
await b.stop();
console.log("2. Zweiter Start (Daten bleiben, kein erneutes Seeden)");
b = await start(opts);
await check(b, "Zweiter Start");
await b.stop();
if (!process.env.DATA_DIR) fs.rmSync(dataDir, { recursive: true, force: true });
console.log("OK");
