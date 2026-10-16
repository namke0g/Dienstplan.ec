// Electron shell: starts the backend (embedded PostgreSQL + web server, see backend.cjs) and shows the web app in a window.
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { start } = require("./backend.cjs");

const smoke = process.argv.includes("--smoke"); // CI: start everything, check it, quit with exit code 0/1
const packaged = app.isPackaged;
const root = packaged ? process.resourcesPath : path.join(__dirname, "..", "build");
const appDir = path.join(root, packaged ? "web" : "app");
const migrationsDir = path.join(root, "migrations");
const userDir = smoke ? path.join(app.getPath("temp"), `dienstplan-smoke-${process.pid}`) : app.getPath("userData");
const dataDir = path.join(userDir, "data");
const logFile = path.join(userDir, "dienstplan.log");

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try { fs.mkdirSync(userDir, { recursive: true }); fs.appendFileSync(logFile, line); } catch {}
  if (smoke) {
    console.log(message);
    // a packaged Windows app has no console: CI reads the result from this file
    if (process.env.SMOKE_LOG) try { fs.appendFileSync(process.env.SMOKE_LOG, line); } catch {}
  }
}

process.on("unhandledRejection", (e) => log(`Unbehandelter Fehler: ${e}`));

let backend = null;
let win = null;
let quitting = false;

const splash = (text) => `data:text/html;charset=utf-8,${encodeURIComponent(
  `<body style="margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;color:#334;background:#f4f6fa"><div style="text-align:center"><div style="font-size:26px;font-weight:600;margin-bottom:8px">Dienstplan</div><div>${text}</div></div></body>`)}`;

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 420, minHeight: 600, show: !smoke, title: "Dienstplan", autoHideMenuBar: false, webPreferences: { sandbox: true, contextIsolation: true } });
  win.loadURL(splash("Wird gestartet … beim ersten Start dauert das etwa eine halbe Minute."));
  win.on("closed", () => { win = null; });
}

function openInBrowserIfExternal(contents, origin) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin) && !url.startsWith("data:")) { event.preventDefault(); shell.openExternal(url); }
  });
}

function buildMenu(url) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Datei", submenu: [
      { label: "Im Browser öffnen", click: () => shell.openExternal(url) },
      { label: "Ordner mit den Daten öffnen", click: () => shell.openPath(userDir) },
      { type: "separator" },
      { role: "quit", label: "Beenden" },
    ] },
    { label: "Ansicht", submenu: [
      { role: "reload", label: "Neu laden" }, { role: "togglefullscreen", label: "Vollbild" },
      { type: "separator" }, { role: "zoomIn", label: "Vergrößern" }, { role: "zoomOut", label: "Verkleinern" }, { role: "resetZoom", label: "Normalgröße" },
    ] },
  ]));
}

async function smokeCheck(url) {
  const health = await (await fetch(`${url}/api/health`)).json();
  if (health.status !== "ok") throw new Error(`Health: ${JSON.stringify(health)}`);
  const login = await fetch(`${url}/login`);
  const html = await login.text();
  if (!login.ok || !html.includes("Anmelden")) throw new Error(`Login-Seite: HTTP ${login.status}`);
  // the window itself must also load the page
  await win.loadURL(`${url}/login`);
  const title = await win.webContents.executeJavaScript("document.body.innerText");
  if (!title.includes("Anmelden")) throw new Error("Das Fenster zeigt die Login-Seite nicht an.");
  // a real login in the window (also proves the session cookie is accepted on this http address)
  await win.webContents.executeJavaScript(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.querySelector("input[name=email]"), "planer@demo.de");
    set(document.querySelector("input[name=password]"), "demo1234");
    document.querySelector("form button").click();
  })()`);
  const until = Date.now() + 20_000;
  while (new URL(win.webContents.getURL()).pathname.startsWith("/login")) {
    if (Date.now() > until) throw new Error("Anmeldung mit planer@demo.de hat nicht funktioniert (Seite blieb auf /login).");
    await new Promise((r) => setTimeout(r, 300));
  }
  log(`SMOKE OK: Datenbank, Demo-Daten, Web-Server, Fenster und Anmeldung funktionieren (nach Login: ${new URL(win.webContents.getURL()).pathname}).`);
}

async function run() {
  createWindow();
  try {
    backend = await start({ dataDir, appDir, migrationsDir, log });
    log(`Läuft unter ${backend.url}`);
    buildMenu(backend.url);
    if (smoke) { await smokeCheck(backend.url); await shutdown(0); return; }
    openInBrowserIfExternal(win.webContents, backend.url);
    await win.loadURL(`${backend.url}/login`);
  } catch (e) {
    log(`FEHLER: ${e.stack || e}`);
    if (smoke) { await shutdown(1); return; }
    dialog.showErrorBox("Dienstplan konnte nicht starten", `${e.message}\n\nDetails stehen in:\n${logFile}`);
    await shutdown(1);
  }
}

async function shutdown(code) {
  if (quitting) return;
  quitting = true;
  try { await backend?.stop(); } catch (e) { log(`Beenden: ${e}`); }
  if (smoke) fs.rmSync(userDir, { recursive: true, force: true });
  app.exit(code);
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second copy would fight over the database folder: bring the first one to the front instead
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on("before-quit", (e) => { if (!quitting) { e.preventDefault(); void shutdown(0); } });
  app.on("window-all-closed", () => { void shutdown(0); });
  app.whenReady().then(run);
}
