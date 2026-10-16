// Assembles desktop/build from the finished Next.js build:
//   build/app         the standalone web server (real files only, short folder names), plus seed.cjs for the demo data
//   build/migrations  the SQL migrations
// Prerequisite (from the repository root): pnpm install && pnpm --filter @dienstplan/db generate && pnpm --filter @dienstplan/web build
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.join(here, "..");
const root = path.join(desktop, "..");
const web = path.join(root, "apps/web");
const standalone = path.join(web, ".next/standalone");
if (!fs.existsSync(path.join(standalone, "apps/web/server.js"))) {
  console.error("apps/web/.next/standalone fehlt. Zuerst im Repository-Wurzelverzeichnis bauen:\n  pnpm --filter @dienstplan/db generate && pnpm --filter @dienstplan/web build");
  process.exit(1);
}

const out = path.join(desktop, "build");
const app = path.join(out, "app");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

// 1. standalone server without its node_modules (pnpm builds those out of symlinks, which Windows only allows for administrators)
const skipModules = (src) => {
  const rel = path.relative(standalone, src).split(path.sep).join("/");
  return rel !== "node_modules" && rel !== "apps/web/node_modules" && !/(^|\/)\.env(\.|$)/.test(path.basename(src));
};
fs.cpSync(standalone, app, { recursive: true, filter: skipModules });
fs.cpSync(path.join(web, ".next/static"), path.join(app, "apps/web/.next/static"), { recursive: true });
fs.cpSync(path.join(web, "public"), path.join(app, "apps/web/public"), { recursive: true });

// 2. ... so lay the packages out flat: app/node_modules/<name>. Every package exists in one version only, which is checked here.
// This also avoids pnpm's very long store folder names (Windows limits paths to 260 characters).
const store = path.join(standalone, "node_modules/.pnpm");
const flat = path.join(app, "node_modules");
const skipPackages = new Set(["typescript"]); // only needed to build, not to run
const placed = new Map();
for (const dir of fs.readdirSync(store)) {
  const modules = path.join(store, dir, "node_modules");
  if (dir === "node_modules" || !fs.existsSync(modules)) continue;
  const own = (parent, name) => {
    const full = path.join(parent, name);
    return !fs.lstatSync(full).isSymbolicLink() ? full : null; // links point at other packages' folders
  };
  const entries = [];
  for (const name of fs.readdirSync(modules)) {
    if (name.startsWith("@")) {
      for (const sub of fs.readdirSync(path.join(modules, name))) entries.push([`${name}/${sub}`, own(path.join(modules, name), sub)]);
    } else entries.push([name, own(modules, name)]);
  }
  for (const [name, from] of entries) {
    if (!from || skipPackages.has(name)) continue;
    const manifest = path.join(from, "package.json");
    const version = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")).version : "-"; // .prisma has none
    if (placed.has(name)) {
      // the same package can show up in several store folders when links had to be copied; two different versions cannot be laid out flat
      if (placed.get(name) !== version) throw new Error(`Paket ${name} kommt in zwei Versionen vor (${placed.get(name)} und ${version}); die flache Anordnung reicht dann nicht.`);
      continue;
    }
    placed.set(name, version);
    fs.cpSync(from, path.join(flat, name), { recursive: true });
  }
}
if (!fs.existsSync(path.join(flat, ".prisma/client"))) throw new Error(".prisma/client (erzeugter Prisma-Client) fehlt im Standalone-Build");

// 3. demo data script (packages/db/prisma/seed.ts) as one file, including the Prisma client; its query engine is passed in by backend.cjs
const engine = fs.readdirSync(path.join(flat, ".prisma/client")).find((f) => /query_engine.*\.(node|dll)$/.test(f));
if (!engine) throw new Error("Prisma Query-Engine fehlt im Standalone-Build");
fs.copyFileSync(path.join(flat, ".prisma/client", engine), path.join(app, "query-engine.node"));
await build({
  entryPoints: [path.join(root, "packages/db/prisma/seed.ts")],
  outfile: path.join(app, "seed.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  logLevel: "warning",
});

// 4. migrations
fs.cpSync(path.join(root, "packages/db/prisma/migrations"), path.join(out, "migrations"), { recursive: true });

const size = (p) => fs.readdirSync(p, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size), 0);
console.log(`desktop/build fertig (${Math.round(size(out) / 1e6)} MB)`);
