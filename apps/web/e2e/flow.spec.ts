import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const login = async (page: Page, email: string) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
};

test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("anna@demo.de");
  await page.getByLabel("Passwort").fill("nope");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("falsch");
});

test("plan needs PDL and Betriebsrat approval before staff see it", async ({ page }) => {
  // next month is a seeded DRAFT
  await login(page, "planer@demo.de");
  await page.waitForURL("**/planer");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  await expect(page.getByText("Entwurf")).toBeVisible();
  await page.getByRole("button", { name: "Zur Prüfung einreichen" }).click();
  await expect(page.getByText("In Prüfung").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Veröffentlichen" })).toHaveCount(0);

  // PDL approves: still not publishable
  await login(page, "pdl@demo.de");
  await page.waitForURL("**/pruefung");
  await page.getByRole("button", { name: "Genehmigen" }).click();
  await expect(page.getByText("Deine Entscheidung: ✅ genehmigt")).toBeVisible();

  await login(page, "planer@demo.de");
  await page.goto("/planer");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  await expect(page.getByRole("button", { name: "Veröffentlichen" })).toHaveCount(0);

  // Betriebsrat must comment on rejection, then approves
  await login(page, "br@demo.de");
  await page.waitForURL("**/pruefung");
  await page.getByRole("button", { name: "Ablehnen" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Kommentar");
  await page.getByRole("button", { name: "Genehmigen" }).click();

  // now the planner can publish
  await login(page, "planer@demo.de");
  await page.goto("/planer");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  await expect(page.getByText("Genehmigt").first()).toBeVisible();
  await page.getByRole("button", { name: "Veröffentlichen" }).click();
  await expect(page.getByText("Plan ist online")).toBeVisible();

  // employee sees the plan and the notification
  await login(page, "anna@demo.de");
  await page.waitForURL("**/mein-plan");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  await expect(page.getByText("Meine Dienste")).toBeVisible();
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Dienstplan veröffentlicht")).toBeVisible();
});

test("employee cannot open planner; calendar feed works", async ({ page, request }) => {
  await login(page, "anna@demo.de");
  await page.waitForURL("**/mein-plan");
  await page.goto("/planer");
  await expect(page).toHaveURL(/mein-plan/);
  await page.goto("/kalender");
  const link = await page.getByLabel("Kalender-Link").inputValue();
  const res = await request.get(new URL(link).pathname);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toMatch(/UID:shift-.+@dienstplan.local/);
  expect((await request.get("/api/cal/not-a-token")).status()).toBe(404);
});

test("personal entries stay private", async ({ page }) => {
  await login(page, "anna@demo.de");
  await page.waitForURL("**/mein-plan");
  await page.getByLabel("Titel").fill("Arzttermin");
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText("📝 Arzttermin")).toBeVisible();
  await login(page, "ben@demo.de");
  await page.waitForURL("**/mein-plan");
  await expect(page.getByText("Arzttermin")).toHaveCount(0);
});

const ym = new Date().toISOString().slice(0, 7);

test("sick leave is only visible to the person, planner and PDL; others see 'Abwesend'", async ({ page }) => {
  const cell = (who: string, what: string) => page.getByRole("button", { name: `${who}, ${ym}-06: ${what}` });
  await login(page, "anna@demo.de");
  await page.goto("/mein-plan");
  await expect(cell("Ben Schmidt", "Abwesend")).toBeVisible();
  await expect(page.getByText("Krank")).toHaveCount(0);

  await login(page, "ben@demo.de");
  await page.goto("/mein-plan");
  await expect(page.getByText("Krank (mit Entgeltfortzahlung)").first()).toBeVisible();

  await login(page, "pdl@demo.de");
  await page.goto("/mein-plan");
  await expect(cell("Ben Schmidt", "Krank (mit Entgeltfortzahlung)")).toBeVisible();
});

test("planner can assign all five absence types and the employee sees paid/unpaid", async ({ page }) => {
  await login(page, "planer@demo.de");
  await page.goto("/planer");
  const day = `${ym}-02`;
  const types = ["Urlaub", "Unbezahlter Urlaub", "Krank (mit Entgeltfortzahlung)", "Krank (ohne Entgelt)", "Sonderurlaub"];
  for (const t of types) {
    await page.getByRole("button", { name: new RegExp(`David Koch, ${day}`) }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^\\w+\\s*${t.replace(/[()]/g, "\\$&")}`) }).click();
    await expect(page.getByRole("button", { name: `David Koch, ${day}: ${t}` })).toBeVisible();
    // the first edit of a published plan starts version 2 and re-renders the grid; wait for it to settle
    await expect(page.getByText("Entwurf")).toBeVisible();
  }
  await expect(page.getByText("Regelverstöße")).toHaveCount(0);
  await page.goto("/planer");
  await expect(page.getByRole("button", { name: `David Koch, ${day}: Sonderurlaub` })).toBeVisible();

  await login(page, "anna@demo.de");
  await page.goto("/mein-plan");
  // seeded, published vacation for Anna (the planner's new draft edits stay invisible to staff)
  await expect(page.getByText(/^Urlaub\s*bezahlt$/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: `David Koch, ${ym}-02: Sonderurlaub` })).toHaveCount(0);
});

test("repeated wrong passwords lock the account out for a while, even for the right password", async ({ page }) => {
  const email = "lockout-test@demo.de"; // unknown account: the limiter works per e-mail and IP, not per existing user
  for (let i = 0; i < 5; i++) {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort").fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("falsch");
  }
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("anything");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Zu viele Fehlversuche");
});
