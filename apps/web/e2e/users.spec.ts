import { expect, test, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

async function signIn(browser: Browser, email: string, password = "demo1234") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  return { ctx, page };
}
const asAdmin = async (browser: Browser) => { const s = await signIn(browser, "admin@demo.de"); await s.page.waitForURL("**/planer"); await s.page.goto("/benutzer"); return s; };
const row = (page: Page, name: string) => page.getByRole("row", { name: new RegExp(name) });
const manage = async (page: Page, name: string) => { await row(page, name).getByText("Verwalten").click(); };

test("admin creates a person: one-time password is shown once, the person can log in, leave entitlement is set", async ({ browser }) => {
  const { page } = await asAdmin(browser);
  const form = page.getByRole("form", { name: "Neue Person anlegen" });

  // a duplicate e-mail is refused and the typed values stay in the form
  await form.getByLabel("Name").fill("Dublette");
  await form.getByLabel("E-Mail").fill("anna@demo.de");
  await form.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("bereits ein Konto");
  await expect(form.getByLabel("Name")).toHaveValue("Dublette");

  await form.getByLabel("Name").fill("Nina Neu");
  await form.getByLabel("E-Mail").fill("nina@demo.de");
  await form.getByLabel(/^Urlaubstage/).fill("27");
  await form.getByRole("button", { name: "Person anlegen" }).click();
  const pw = await page.getByLabel("Einmaliges Passwort").innerText();
  expect(pw).toMatch(/^[A-Za-z0-9]{16}$/);
  await expect(page.getByRole("status").first()).toContainText("Nina Neu");
  await expect(form.getByLabel("Name")).toHaveValue(""); // form was cleared after success
  await expect(row(page, "Nina Neu")).toContainText("aktiv");

  await page.reload(); // the password is gone for good
  await expect(page.getByLabel("Einmaliges Passwort")).toHaveCount(0);

  const nina = await signIn(browser, "nina@demo.de", pw);
  await nina.page.waitForURL("**/mein-plan");
  await nina.ctx.close();

  // the entitlement shows up in the Urlaubskonto
  const planner = await signIn(browser, "planer@demo.de");
  await planner.page.waitForURL("**/planer");
  await planner.page.goto(`/urlaubskonto?y=${new Date().getUTCFullYear()}`);
  await expect(row(planner.page, "Nina Neu").getByRole("cell").first()).toHaveText("27");
  await planner.ctx.close();

  // a password chosen by the admin is never echoed back
  await form.getByLabel("Name").fill("Paul Passwort");
  await form.getByLabel("E-Mail").fill("paul@demo.de");
  await form.getByLabel(/^Passwort/).fill("selbst-gewaehlt-123");
  await form.getByRole("button", { name: "Person anlegen" }).click();
  await expect(page.getByText("wird aus Sicherheitsgründen nicht angezeigt")).toBeVisible();
  await expect(page.getByLabel("Einmaliges Passwort")).toHaveCount(0);
});

test("planners manage employees only; others cannot open the page", async ({ browser }) => {
  const p = await signIn(browser, "planer@demo.de");
  await p.page.waitForURL("**/planer");
  await p.page.goto("/benutzer");
  await expect(p.page.getByRole("row", { name: /Anna Becker/ })).toBeVisible();
  await expect(p.page.getByRole("row", { name: /Paul Dienstleitung/ })).toHaveCount(0); // PDL
  await expect(p.page.getByRole("row", { name: /Ada|Admin/ })).toHaveCount(0);
  const roleOptions = await p.page.getByRole("form", { name: "Neue Person anlegen" }).getByLabel("Rolle").locator("option").allInnerTexts();
  expect(roleOptions).toEqual(["Mitarbeiter:in"]);
  await manage(p.page, "Anna Becker");
  await expect(p.page.getByRole("button", { name: "Endgültig anonymisieren" })).toHaveCount(0); // admin only
  await p.ctx.close();

  for (const email of ["pdl@demo.de", "br@demo.de", "anna@demo.de"]) {
    const s = await signIn(browser, email);
    await s.page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await s.page.goto("/benutzer");
    await expect(s.page).not.toHaveURL(/benutzer/);
    await s.ctx.close();
  }
});

test("admin changes a role, but not their own; own account cannot be deactivated", async ({ browser }) => {
  const { page } = await asAdmin(browser);
  await manage(page, "Ben Schmidt");
  await page.getByRole("form", { name: "Bearbeiten Ben Schmidt" }).getByLabel("Rolle").selectOption("PDL");
  await page.getByRole("form", { name: "Bearbeiten Ben Schmidt" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Gespeichert");
  await expect(row(page, "Ben Schmidt")).toContainText("PDL");
  // restore for later tests
  await manage(page, "Ben Schmidt");
  await page.getByRole("form", { name: "Bearbeiten Ben Schmidt" }).getByLabel("Rolle").selectOption("EMPLOYEE");
  await page.getByRole("form", { name: "Bearbeiten Ben Schmidt" }).getByRole("button", { name: "Speichern" }).click();
  await expect(row(page, "Ben Schmidt")).toContainText("Mitarbeiter:in");

  await manage(page, "Admin");
  await expect(page.getByRole("form", { name: /Bearbeiten Admin/ }).getByLabel("Rolle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deaktivieren" })).toHaveCount(0);
});

test("deactivating signs the person out everywhere and blocks login until reactivated", async ({ browser }) => {
  const ben = await signIn(browser, "ben@demo.de");
  await ben.page.waitForURL("**/mein-plan");
  const { page } = await asAdmin(browser);
  await manage(page, "Ben Schmidt");
  await page.getByRole("button", { name: "Deaktivieren" }).click();
  await expect(page.getByRole("status")).toContainText("deaktiviert");
  await expect(row(page, "Ben Schmidt")).toContainText("deaktiviert");

  await ben.page.goto("/mein-plan"); // running session is dead
  await expect(ben.page).toHaveURL(/login/);
  const again = await signIn(browser, "ben@demo.de");
  await expect(again.page.locator("p[role=alert]")).toContainText("falsch");
  await again.ctx.close();

  await manage(page, "Ben Schmidt");
  await page.getByRole("button", { name: "Wieder aktivieren" }).click();
  await expect(row(page, "Ben Schmidt")).toContainText("aktiv");
  const back = await signIn(browser, "ben@demo.de");
  await back.page.waitForURL("**/mein-plan");
  await ben.ctx.close(); await back.ctx.close();
});

test("resetting a password shows a new one-time password and ends old sessions", async ({ browser }) => {
  const clara = await signIn(browser, "clara@demo.de");
  await clara.page.waitForURL("**/mein-plan");
  const { page } = await asAdmin(browser);
  await manage(page, "Clara Wolf");
  await page.getByRole("button", { name: "Neues Passwort erzeugen" }).click();
  const pw = await page.getByLabel("Einmaliges Passwort").innerText();
  expect(pw).toMatch(/^[A-Za-z0-9]{16}$/);

  await clara.page.goto("/mein-plan");
  await expect(clara.page).toHaveURL(/login/);
  const oldPw = await signIn(browser, "clara@demo.de");
  await expect(oldPw.page.locator("p[role=alert]")).toContainText("falsch");
  const fresh = await signIn(browser, "clara@demo.de", pw);
  await fresh.page.waitForURL("**/mein-plan");
  for (const x of [clara, oldPw, fresh]) await x.ctx.close();
});

test("anonymising needs deactivation and a typed confirmation, and past rosters keep the person's row", async ({ browser }) => {
  const { page } = await asAdmin(browser);
  await manage(page, "Felix Braun");
  await expect(page.getByRole("button", { name: "Endgültig anonymisieren" })).toHaveCount(0); // still active
  await page.getByRole("button", { name: "Deaktivieren" }).click();
  await expect(row(page, "Felix Braun")).toContainText("deaktiviert");

  await manage(page, "Felix Braun");
  const form = page.getByRole("form", { name: "Anonymisieren Felix Braun" });
  await form.getByLabel(/Zur Bestätigung/).fill("falsch@demo.de");
  await form.getByRole("button", { name: "Endgültig anonymisieren" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("stimmt nicht");
  await expect(row(page, "Felix Braun")).toContainText("deaktiviert"); // nothing happened

  await manage(page, "Felix Braun");
  await page.getByRole("form", { name: "Anonymisieren Felix Braun" }).getByLabel(/Zur Bestätigung/).fill("felix@demo.de");
  await page.getByRole("form", { name: "Anonymisieren Felix Braun" }).getByRole("button", { name: "Endgültig anonymisieren" }).click();
  await expect(page.getByRole("status")).toContainText("anonymisiert");
  await expect(row(page, "Ehemalige Person")).toContainText("anonymisiert");
  await expect(page.getByText("felix@demo.de")).toHaveCount(0);
  await expect(page.getByText("Felix Braun")).toHaveCount(0);

  // the current month's roster still has the row (with shifts), now under the anonymous name
  const ym = new Date().toISOString().slice(0, 7);
  const planner = await signIn(browser, "planer@demo.de");
  await planner.page.waitForURL("**/planer");
  await planner.page.goto(`/planer?m=${ym}`);
  await expect(planner.page.getByRole("rowheader", { name: /Ehemalige Person/ })).toBeVisible();
  await expect(planner.page.getByRole("button", { name: new RegExp(`Ehemalige Person \\d+, ${ym}-\\d\\d: (Früh|Spät|Nacht)dienst`) }).first()).toBeVisible();
  // a month without shifts for that person no longer lists them
  const far = new Date(); far.setUTCMonth(far.getUTCMonth() + 6);
  await planner.page.goto(`/planer?m=${far.toISOString().slice(0, 7)}`);
  await expect(planner.page.getByRole("rowheader", { name: /Ehemalige Person/ })).toHaveCount(0);
  await planner.ctx.close();
});
