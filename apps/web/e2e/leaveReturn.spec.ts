import { addDaysYmd, localToday } from "@dienstplan/core";
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

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

test("approved leave can be given back with the planner's consent, and the employee is told", async ({ page }) => {
  const from = addDaysYmd(localToday(), 40), to = addDaysYmd(from, 1);
  const dmy = (d: string) => d.split("-").reverse().join(".");

  await login(page, "david@demo.de");
  await page.goto("/urlaub");
  await page.getByLabel("Art").selectOption({ label: "Urlaub" });
  await page.getByLabel("Von").fill(from);
  await page.getByLabel("Bis").fill(to);
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.getByRole("status")).toContainText("Antrag gesendet");

  await login(page, "pdl@demo.de");
  await page.goto("/antraege");
  await page.getByRole("form", { name: "Antrag David Koch" }).getByRole("button", { name: "Genehmigen" }).click();
  await expect(page.getByRole("form", { name: "Antrag David Koch" })).toHaveCount(0);

  await login(page, "david@demo.de");
  await page.goto("/urlaub");
  await page.getByText("Urlaub zurückgeben …").click();
  const give = page.getByRole("form", { name: `Rückgabe Urlaub ${dmy(from)}` });
  await give.getByLabel("Grund für die Rückgabe").fill("Reise abgesagt");
  await give.getByRole("button", { name: "Rückgabe beantragen" }).click();
  await expect(page.getByText("Rückgabe beantragt", { exact: true })).toBeVisible();

  // a refusal needs a reason
  await login(page, "planer@demo.de");
  await page.goto("/antraege");
  const ret = page.getByRole("form", { name: "Rückgabe David Koch" });
  await expect(ret).toContainText("Reise abgesagt");
  await ret.getByRole("button", { name: "Ablehnen" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Begründung");
  await page.getByRole("form", { name: "Rückgabe David Koch" }).getByRole("button", { name: "Zustimmen" }).click();
  await expect(page.getByRole("form", { name: "Rückgabe David Koch" })).toHaveCount(0);

  await login(page, "david@demo.de");
  await page.goto("/urlaub");
  await expect(page.getByText("Zurückgegeben", { exact: true })).toBeVisible();
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Rückgabe genehmigt").first()).toBeVisible();
});
