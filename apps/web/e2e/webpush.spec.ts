import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createServer, type Server } from "node:https";
import { createECDH, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// A stand-in for a browser vendor's push service (FCM, Mozilla, Apple), reached over HTTPS like the real ones.
const received: { path: string; headers: Record<string, string | string[] | undefined>; bytes: number }[] = [];
let push: Server;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" });
  const dir = process.env.PUSH_TEST_CERT_DIR!; // created by playwright.config.ts and trusted by the app server
  push = createServer({ key: readFileSync(`${dir}/k.pem`), cert: readFileSync(`${dir}/c.pem`) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, bytes: Buffer.concat(chunks).length });
      res.statusCode = req.url?.includes("gone") ? 410 : 201;
      res.end();
    });
  }).listen(3198);
});
test.afterAll(() => { push.close(); });

/** A syntactically and cryptographically valid browser subscription pointing at the fake push service. */
const subscription = (name: string) => {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { endpoint: `https://localhost:3198/${name}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
};
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const mobile = async (request: APIRequestContext, email: string) =>
  ({ headers: { authorization: `Bearer ${(await (await request.post("/api/mobile/login", { data: { email, password: "demo1234" } })).json()).token}` } });

test("service worker is served and the browser toggle appears when Web Push is configured", async ({ page, request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain('addEventListener("push"');

  await login(page, "anna@demo.de");
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Browser-Mitteilungen")).toBeVisible();
  await expect(page.getByRole("button", { name: "In diesem Browser einschalten" })).toBeVisible(); // service worker registered, not yet subscribed
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(true);
});

test("subscription endpoint: login required, input validated, own subscriptions only", async ({ page, request }) => {
  expect((await request.post("/api/push/register", { data: subscription("x") })).status()).toBe(401);
  await login(page, "anna@demo.de");
  const api = page.request; // carries Anna's session cookie
  for (const bad of [
    {},
    { ...subscription("x"), endpoint: "http://insecure.example/x" },
    { ...subscription("x"), keys: { p256dh: "not base64!", auth: "abc" } },
    { ...subscription("x"), endpoint: `https://example.com/${"a".repeat(3000)}` },
  ]) expect((await api.post("/api/push/register", { data: bad })).status()).toBe(400);
  expect((await api.post("/api/push/register", { data: subscription("anna-pc") })).status()).toBe(204);
  expect((await api.delete("/api/push/register", { data: { endpoint: "https://localhost:3198/anna-pc" } })).status()).toBe(204);
});

test("a real event reaches the browser's push service: encrypted, VAPID-signed, with urgency and TTL", async ({ page, request }) => {
  // the planner subscribes this browser; then an employee files a leave request, which notifies the planner
  await login(page, "planer@demo.de");
  expect((await page.request.post("/api/push/register", { data: subscription("planner-pc") })).status()).toBe(204);
  received.length = 0;

  const anna = await mobile(request, "anna@demo.de");
  const types = (await (await request.get("/api/mobile/leave", anna)).json()).types as { id: string; name: string }[];
  const d = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const r = await request.post("/api/mobile/leave", { ...anna, data: { typeId: types.find((t) => t.name === "Unbezahlter Urlaub")!.id, start: d, end: d } });
  expect(r.status()).toBe(201);

  await expect.poll(() => received.filter((x) => x.path === "/planner-pc").length).toBe(1);
  const msg = received.find((x) => x.path === "/planner-pc")!;
  expect(msg.headers["content-encoding"]).toBe("aes128gcm"); // payload is end-to-end encrypted for that browser
  expect(String(msg.headers.authorization)).toMatch(/^vapid t=.+, k=.+/); // signed with our VAPID key
  expect(msg.headers.ttl).toBe("86400");
  expect(msg.headers.urgency).toBe("normal");
  expect(msg.bytes).toBeGreaterThan(0);

  // in-app list says it was delivered by push
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Neuer Abwesenheitsantrag").first()).toBeVisible();
  await expect(page.getByText(/Push zugestellt/).first()).toBeVisible();
});

test("a subscription the push service reports as gone is removed and not used again", async ({ page, request }) => {
  await login(page, "pdl@demo.de");
  expect((await page.request.post("/api/push/register", { data: subscription("pdl-gone") })).status()).toBe(204);
  received.length = 0;
  const ben = await mobile(request, "ben@demo.de");
  const types = (await (await request.get("/api/mobile/leave", ben)).json()).types as { id: string; name: string }[];
  const unpaid = types.find((t) => t.name === "Unbezahlter Urlaub")!.id;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await request.post("/api/mobile/leave", { ...ben, data: { typeId: unpaid, start: day(100), end: day(100) } });
  await expect.poll(() => received.filter((x) => x.path === "/pdl-gone").length).toBe(1); // got 410
  await request.post("/api/mobile/leave", { ...ben, data: { typeId: unpaid, start: day(110), end: day(110) } });
  await page.waitForTimeout(1000);
  expect(received.filter((x) => x.path === "/pdl-gone").length).toBe(1); // not contacted again
});
