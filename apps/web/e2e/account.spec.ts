import { expect, test, type Browser } from "@playwright/test";
import { execSync } from "node:child_process";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

async function signIn(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  return { ctx, page };
}

test("changing the password: validation, new login works, old password and other sessions stop working", async ({ browser }) => {
  const a = await signIn(browser, "david@demo.de", "demo1234");
  await a.page.waitForURL("**/mein-plan");
  const b = await signIn(browser, "david@demo.de", "demo1234"); // a second device
  await b.page.waitForURL("**/mein-plan");

  await a.page.goto("/konto");
  const submit = async (cur: string, next: string, rep: string) => {
    await a.page.getByLabel("Aktuelles Passwort").fill(cur);
    await a.page.getByLabel(/^Neues Passwort \(mindestens/).fill(next);
    await a.page.getByLabel("Neues Passwort wiederholen").fill(rep);
    await a.page.getByRole("button", { name: "Passwort ändern" }).click();
  };
  await submit("falsch-falsch", "ein-neues-passwort-1", "ein-neues-passwort-1");
  await expect(a.page.locator("p[role=alert]")).toContainText("aktuelle Passwort ist falsch");
  await submit("demo1234", "ein-neues-passwort-1", "etwas-anderes-123");
  await expect(a.page.locator("p[role=alert]")).toContainText("stimmen nicht überein");
  await submit("demo1234", "ein-neues-passwort-1", "ein-neues-passwort-1");
  await expect(a.page.getByRole("status")).toContainText("Passwort geändert");

  await a.page.goto("/mein-plan"); // the device that changed it stays signed in
  await expect(a.page).toHaveURL(/mein-plan/);
  await b.page.goto("/mein-plan"); // the other device is signed out
  await expect(b.page).toHaveURL(/login/);

  const old = await signIn(browser, "david@demo.de", "demo1234");
  await expect(old.page.locator("p[role=alert]")).toContainText("falsch");
  const fresh = await signIn(browser, "david@demo.de", "ein-neues-passwort-1");
  await fresh.page.waitForURL("**/mein-plan");
  for (const x of [a, b, old, fresh]) await x.ctx.close();
});
