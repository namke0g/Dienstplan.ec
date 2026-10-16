import { localToday } from "@dienstplan/core";
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
const t = localToday();
const next = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 1)).toISOString().slice(0, 7); // seeded as DRAFT
const day = `${next}-10`;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

test("employee wishes a day off and sets preferences; the planner sees them in the grid, nobody else", async ({ page }) => {
  await login(page, "anna@demo.de");
  await page.goto("/wuensche");
  const form = page.getByRole("form", { name: "Wunsch eintragen" });
  await form.getByLabel("Tag").fill(day);
  await form.getByLabel("Wunsch").selectOption({ label: "Wunschfrei" });
  await form.getByLabel("Anmerkung").fill("Hochzeit meiner Schwester");
  await form.getByRole("button", { name: "Wunsch speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Wunsch gespeichert");
  await expect(page.getByRole("listitem", { name: /^Wunsch / })).toContainText("Wunschfrei");
  await page.getByLabel("Nachtdienst: möglichst nicht").check();
  await page.getByRole("button", { name: "Vorlieben speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Vorlieben gespeichert");
  await expect(page.getByLabel("Nachtdienst: möglichst nicht")).toBeChecked();

  // the current month is closed for wishes
  await page.goto(`/wuensche?m=${t.slice(0, 7)}`);
  await expect(page.getByRole("form", { name: "Wunsch eintragen" })).toHaveCount(0);

  await login(page, "planer@demo.de");
  await page.goto(`/planer?m=${next}`);
  await expect(page.getByRole("button", { name: new RegExp(`^Anna Becker, ${day}: .*Wunschfrei`) })).toBeVisible();
  const summary = page.getByRole("group", { name: "Wünsche der Mitarbeitenden" });
  await summary.locator("summary").click();
  await expect(summary).toContainText("möglichst nicht N");

  // Betriebsrat and colleagues never see wishes
  for (const who of ["br@demo.de", "ben@demo.de"]) {
    await login(page, who);
    for (const path of ["/pruefung", "/mein-plan"]) {
      const r = await page.goto(`${path}?m=${next}`);
      if (r?.ok()) await expect(page.getByText(/Wunschfrei|Hochzeit/)).toHaveCount(0);
    }
  }
});
