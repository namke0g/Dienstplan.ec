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

test("planner can paint all five leave types and staff see them", async ({ page }) => {
  await login(page, "planer@demo.de");
  await page.waitForURL("**/planer");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  const leave = [
    ["Urlaub", "U"], ["Unbezahlter Urlaub", "UU"], ["Krank (bezahlt)", "K"], ["Krank (unbezahlt)", "KU"], ["Sonderurlaub", "SU"],
  ] as const;
  const cells = page.getByRole("button", { name: /^Felix Braun, \d{4}-\d{2}-\d{2}:/ });
  for (const [i, [name, code]] of leave.entries()) {
    await page.getByRole("radio", { name: `${code} ${name}`, exact: true }).click();
    await cells.nth(i).click();
    await expect(cells.nth(i)).toHaveAttribute("aria-label", new RegExp(`: ${name.replace(/[()]/g, "\\$&")}$`));
  }
  await page.reload();
  for (const [i, [name]] of leave.entries()) {
    await expect(cells.nth(i)).toHaveAttribute("aria-label", new RegExp(`: ${name.replace(/[()]/g, "\\$&")}$`));
  }

  // seeded published absences are visible to the employee
  await login(page, "anna@demo.de");
  await page.waitForURL("**/mein-plan");
  await expect(page.getByTestId("leave-summary")).toContainText("Urlaub");
  await expect(page.getByTestId("leave-summary")).toContainText("Krank (bezahlt)");
});
