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

const ROLES: Record<string, string[]> = {
  "anna@demo.de": ["/mein-plan", "/urlaub", "/tausch", "/wuensche", "/krank", "/kalender", "/benachrichtigungen", "/konto"],
  "planer@demo.de": ["/planer", "/mein-plan", "/antraege", "/krank", "/urlaubskonto", "/benutzer", "/kalender"],
  "pdl@demo.de": ["/pruefung", "/mein-plan", "/antraege", "/krank", "/urlaubskonto"],
  "br@demo.de": ["/pruefung", "/mein-plan", "/urlaub"],
  "admin@demo.de": ["/planer", "/benutzer", "/einstellungen", "/urlaubskonto"],
};

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

for (const scheme of ["light", "dark"] as const) {
  test(`every page renders on a phone (390 px, ${scheme}) without errors or sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|service worker|ServiceWorker/i.test(m.text())) errors.push(m.text()); });
    for (const [email, paths] of Object.entries(ROLES)) {
      await login(page, email);
      for (const path of paths) {
        const res = await page.goto(path);
        expect(res?.status(), `${email} ${path}`).toBeLessThan(400);
        await expect(page.locator("header")).toBeVisible();
        // the roster grid scrolls inside its card; the page itself must not
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${email} ${path} scrolls sideways`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `test-results/screens/${scheme}-${email.split("@")[0]}${path.replace(/\//g, "_")}.png`, fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}
