import { expect, test, type Browser, type Page } from "@playwright/test";
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
      const answer = () => {
        received.push({ path: req.url ?? "", headers: req.headers, bytes: Buffer.concat(chunks).length });
        res.statusCode = req.url?.includes("gone") ? 410 : 201;
        res.end();
      };
      if (req.url?.includes("slow")) setTimeout(answer, 3000); else answer(); // "slow": a sluggish push service
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
/** An employee files unpaid leave through the web form in a separate browser; resolves with how long the request took. */
async function fileLeave(browser: Browser, email: string, inDays: number) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  await page.goto("/urlaub");
  const d = new Date(Date.now() + inDays * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Art").selectOption({ label: "Unbezahlter Urlaub (unbezahlt)" });
  await page.getByLabel("Von").fill(d);
  await page.getByLabel("Bis").fill(d);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.getByRole("status")).toContainText("Antrag gesendet");
  const took = Date.now() - t0;
  await ctx.close();
  return took;
}

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
    { ...subscription("x"), endpoint: "https://10.0.0.5:8443/admin" }, // internal address: never accepted
    { ...subscription("x"), endpoint: "https://evil.example/collect" }, // not a push service
    { ...subscription("x"), endpoint: "http://insecure.example/x" },
    { ...subscription("x"), keys: { p256dh: "not base64!", auth: "abc" } },
    { ...subscription("x"), endpoint: `https://example.com/${"a".repeat(3000)}` },
  ]) expect((await api.post("/api/push/register", { data: bad })).status()).toBe(400);
  expect((await api.post("/api/push/register", { data: subscription("anna-pc") })).status()).toBe(204);
  expect((await api.delete("/api/push/register", { data: { endpoint: "https://localhost:3198/anna-pc" } })).status()).toBe(204);
});

test("a real event reaches the browser's push service: encrypted, VAPID-signed, with urgency and TTL", async ({ page, browser }) => {
  // the planner subscribes this browser; then an employee files a leave request, which notifies the planner
  await login(page, "planer@demo.de");
  expect((await page.request.post("/api/push/register", { data: subscription("planner-pc") })).status()).toBe(204);
  received.length = 0;

  await fileLeave(browser, "anna@demo.de", 90);

  await expect.poll(() => received.filter((x) => x.path === "/planner-pc").length).toBe(1);
  const msg = received.find((x) => x.path === "/planner-pc")!;
  expect(msg.headers["content-encoding"]).toBe("aes128gcm"); // payload is end-to-end encrypted for that browser
  expect(String(msg.headers.authorization)).toMatch(/^vapid t=.+, k=.+/); // signed with our VAPID key
  expect(msg.headers.ttl).toBe("86400");
  expect(msg.headers.urgency).toBe("normal");
  expect(msg.bytes).toBeGreaterThan(0);

  // in-app list says it was delivered by push (delivery runs after the response, so reload until it is recorded)
  await expect.poll(async () => { await page.goto("/benachrichtigungen"); return page.getByText(/Push zugestellt/).count(); }).toBeGreaterThan(0);
  await expect(page.getByText("Neuer Abwesenheitsantrag").first()).toBeVisible();
});

test("a subscription the push service reports as gone is removed and not used again", async ({ page, browser }) => {
  await login(page, "pdl@demo.de");
  expect((await page.request.post("/api/push/register", { data: subscription("pdl-gone") })).status()).toBe(204);
  received.length = 0;
  await fileLeave(browser, "ben@demo.de", 100);
  await expect.poll(() => received.filter((x) => x.path === "/pdl-gone").length).toBe(1); // got 410
  await fileLeave(browser, "ben@demo.de", 110);
  await page.waitForTimeout(1000);
  expect(received.filter((x) => x.path === "/pdl-gone").length).toBe(1); // not contacted again
});

test("a slow push service does not make anyone wait: the request answers first, the push follows", async ({ page, browser }) => {
  await login(page, "planer@demo.de");
  expect((await page.request.post("/api/push/register", { data: subscription("slow-pc") })).status()).toBe(204);
  received.length = 0;
  const took = await fileLeave(browser, "eva@demo.de", 120);
  expect(took).toBeLessThan(2500); // the push service needs 3 s; before the fix the request waited for it
  await expect.poll(() => received.filter((x) => x.path === "/slow-pc").length, { timeout: 10_000 }).toBe(1); // and the push still arrives
});

test("closing the permission prompt without a choice does not claim notifications are blocked (#3)", async ({ page }) => {
  await page.addInitScript(() => { Notification.requestPermission = async () => "default"; }); // user dismissed the prompt
  await login(page, "anna@demo.de");
  await page.goto("/benachrichtigungen");
  await page.getByRole("button", { name: "In diesem Browser einschalten" }).click();
  await expect(page.getByRole("button", { name: "In diesem Browser einschalten" })).toBeVisible(); // can simply try again
  await expect(page.getByText(/blockiert/)).toHaveCount(0);
});

test("logging out never hangs on push clean-up, and a double click logs out once (#10)", async ({ page }) => {
  // this browser has a push subscription (stubbed: headless browsers cannot subscribe to a real push service)
  await page.addInitScript(() => {
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/stub", options: {}, toJSON: () => ({}), unsubscribe: async () => true };
    const reg = { pushManager: { getSubscription: async () => sub } };
    navigator.serviceWorker.getRegistration = (async () => reg) as unknown as typeof navigator.serviceWorker.getRegistration;
  });
  let deletes = 0;
  await page.route("**/api/push/register", (route) => {
    if (route.request().method() === "DELETE") { deletes++; return; } // the server never answers
    return route.continue();
  });
  await login(page, "anna@demo.de");
  const button = page.getByRole("button", { name: "Abmelden" });
  const t0 = Date.now();
  await button.click();
  await page.getByRole("button", { name: /Abmelden/ }).click({ force: true, timeout: 1000 }).catch(() => {}); // impatient second click
  await page.waitForURL(/\/login/, { timeout: 8000 });
  expect(Date.now() - t0).toBeLessThan(6000); // gave up on the hanging request after about 3 s
  expect(deletes).toBe(1);
  await page.goto("/mein-plan");
  await expect(page).toHaveURL(/\/login/); // really logged out
});
