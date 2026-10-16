// Starts everything the desktop app needs, without any Electron API so it can also run (and be tested) under plain Node:
//   1. an embedded PostgreSQL in <dataDir>/postgres
//   2. the database schema (the SQL files of packages/db/prisma/migrations) and, on the very first start, the demo data
//   3. the Next.js standalone server on a local port
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DB_NAME = "dienstplan";
const DB_USER = "dienstplan";

function freePort(preferred) {
  const tryPort = (p) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(null));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(p)));
    });
  return tryPort(preferred).then((p) => p ?? tryPort(0));
}

/** Settings that must stay the same between starts: database password and the key that signs login sessions. */
function loadConfig(dataDir) {
  const file = path.join(dataDir, "config.json");
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c.sessionSecret && c.dbPassword) return c;
  } catch {}
  const c = { sessionSecret: crypto.randomBytes(32).toString("hex"), dbPassword: crypto.randomBytes(18).toString("hex") };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  return c;
}

async function applyMigrations(client, migrationsDir, log) {
  await client.query(`CREATE TABLE IF NOT EXISTS _desktop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query("SELECT name FROM _desktop_migrations")).rows.map((r) => r.name));
  const names = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const name of names) {
    if (done.has(name)) continue;
    log(`Datenbank: ${name}`);
    const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _desktop_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${name} fehlgeschlagen: ${e.message}`);
    }
  }
}

function runNode(script, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(script)} beendet mit Code ${code}\n${out.slice(-2000)}`))));
  });
}

async function waitForHealth(url, child, timeoutMs) {
  const start = Date.now();
  let exited = null;
  child.once("exit", (code) => (exited = code));
  while (Date.now() - start < timeoutMs) {
    if (exited !== null) throw new Error(`Der Web-Server wurde beendet (Code ${exited}).`);
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Der Web-Server ist nicht rechtzeitig gestartet.");
}

/**
 * @param {{dataDir: string, appDir: string, migrationsDir: string, log?: (m: string) => void}} o
 *   appDir = Next.js standalone folder (contains apps/web/server.js and seed.cjs)
 */
async function start({ dataDir, appDir, migrationsDir, log = () => {} }) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const cfg = loadConfig(dataDir);
  const pgDir = path.join(dataDir, "postgres");
  const fresh = !fs.existsSync(path.join(pgDir, "PG_VERSION"));
  const pgPort = await freePort(54329);
  const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: DB_USER, password: cfg.dbPassword, port: pgPort, persistent: true, onLog: () => {}, onError: (m) => log(`[postgres] ${String(m).trim()}`) });

  log(fresh ? "Datenbank wird angelegt …" : "Datenbank wird gestartet …");
  if (fresh) await pg.initialise();
  await pg.start();
  const stopPostgres = () => pg.stop().catch(() => {});

  let web = null;
  try {
    if (fresh) await pg.createDatabase(DB_NAME);
    const client = pg.getPgClient(DB_NAME);
    await client.connect();
    let needsSeed;
    try {
      await applyMigrations(client, migrationsDir, log);
      // demo data only once: on a brand-new database that has never been seeded
      needsSeed = !fs.existsSync(path.join(dataDir, "no-demo-data")) && (await client.query(`SELECT count(*)::int AS n FROM "User"`)).rows[0].n === 0;
    } finally {
      await client.end();
    }

    const databaseUrl = `postgresql://${DB_USER}:${encodeURIComponent(cfg.dbPassword)}@127.0.0.1:${pgPort}/${DB_NAME}`;
    const baseEnv = { DATABASE_URL: databaseUrl, SESSION_SECRET: cfg.sessionSecret, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PRISMA_QUERY_ENGINE_LIBRARY: path.join(appDir, "query-engine.node") };
    if (needsSeed) {
      log("Demo-Daten werden angelegt …");
      await runNode(path.join(appDir, "seed.cjs"), [], baseEnv, appDir);
      fs.writeFileSync(path.join(dataDir, "no-demo-data"), "Demo-Daten wurden angelegt; werden nicht erneut eingespielt.\n");
    }

    const port = await freePort(38080);
    const url = `http://127.0.0.1:${port}`;
    log("Web-Server wird gestartet …");
    web = spawn(process.execPath, [path.join(appDir, "apps", "web", "server.js")], {
      cwd: path.join(appDir, "apps", "web"),
      env: { ...process.env, ...baseEnv, PORT: String(port), HOSTNAME: "127.0.0.1", ELECTRON_RUN_AS_NODE: "1", PUSH_RETRY_SECONDS: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let tail = "";
    const keep = (d) => { tail = (tail + d).slice(-2000); };
    web.stdout.on("data", keep);
    web.stderr.on("data", keep);
    try {
      await waitForHealth(url, web, 60_000);
    } catch (e) {
      throw new Error(`${e.message}\n${tail}`);
    }
    const stop = async () => {
      if (web && web.exitCode === null) { web.kill(); await new Promise((r) => { web.once("exit", r); setTimeout(r, 5000); }); }
      await stopPostgres();
    };
    return { url, databaseUrl, stop };
  } catch (e) {
    if (web && web.exitCode === null) web.kill();
    await stopPostgres();
    throw e;
  }
}

module.exports = { start };
