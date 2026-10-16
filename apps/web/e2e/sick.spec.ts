import { addDaysYmd, localToday } from "@dienstplan/core";
import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const today = localToday(); // the ward's date, as the server sees it
const tomorrow = addDaysYmd(today, 1);
/** what the planner grid shows for a person on a day, e.g. "Frühdienst" or "frei" */
async function cell(page: Page, name: string, date: string) {
  await page.goto(`/planer?m=${date.slice(0, 7)}`);
  const label = await page.getByRole("button", { name: new RegExp(`^${name}, ${date}: `) }).getAttribute("aria-label");
  return label!.split(": ")[1]!;
}

test("an employee reports sick: days become sick at once, colleagues see 'Abwesend', planners are told; back early restores the shift", async ({ page }) => {
  await login(page, "planer@demo.de");
  const plannedTomorrow = await cell(page, "Anna Becker", tomorrow);

  await login(page, "anna@demo.de");
  await page.goto("/krank");
  await expect(page.getByText("keine Diagnose")).toBeVisible();
  const form = page.getByRole("form", { name: "Krankmeldung erfassen" });
  await form.getByLabel("Erster Krankheitstag").fill(today);
  await form.getByLabel("Voraussichtlich bis").fill(tomorrow);
  await form.getByLabel(/Hinweis/).fill("eAU folgt");
  await form.getByRole("button", { name: "Krank melden" }).click();
  await expect(page.getByRole("status")).toContainText("Gute Besserung");

  await login(page, "planer@demo.de");
  expect(await cell(page, "Anna Becker", today)).toBe("Krank (mit Entgeltfortzahlung)");
  expect(await cell(page, "Anna Becker", tomorrow)).toBe("Krank (mit Entgeltfortzahlung)");
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Krankmeldung: Anna Becker").first()).toBeVisible();
  await page.goto("/krank");
  await expect(page.getByRole("listitem", { name: "Krankmeldung Anna Becker" })).toContainText("eAU folgt");

  // a colleague sees only that Anna is absent, not why (only in published months)
  await login(page, "ben@demo.de");
  await page.goto(`/mein-plan?m=${today.slice(0, 7)}`);
  await expect(page.getByRole("button", { name: `Anna Becker, ${today}: Abwesend` })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Anna Becker, .*: Krank/ })).toHaveCount(0); // (Ben's own sick days are his to see)

  // Anna is back tomorrow: tomorrow gets its original shift back
  await login(page, "anna@demo.de");
  await page.goto("/krank");
  const item = page.getByRole("listitem", { name: "Krankmeldung Anna Becker" });
  await item.getByLabel("Wieder gesund ab").fill(tomorrow);
  await item.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toContainText("wieder im Plan");
  await login(page, "planer@demo.de");
  expect(await cell(page, "Anna Becker", tomorrow)).toBe(plannedTomorrow);
  expect(await cell(page, "Anna Becker", today)).toBe("Krank (mit Entgeltfortzahlung)");
});

test("planners report on someone's behalf; the person is told; the Betriebsrat has no access", async ({ page }) => {
  await login(page, "planer@demo.de");
  await page.goto("/krank");
  const form = page.getByRole("form", { name: "Krankmeldung erfassen" });
  await form.getByLabel("Für").selectOption({ label: "Ben Schmidt" });
  await form.getByLabel("Erster Krankheitstag").fill(today);
  await form.getByLabel("Voraussichtlich bis").fill(today);
  await form.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByRole("status")).toContainText("erfasst");
  await expect(page.getByRole("listitem", { name: "Krankmeldung Ben Schmidt" })).toContainText("erfasst von Petra Planer");

  await login(page, "ben@demo.de");
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Krankmeldung erfasst")).toBeVisible();

  await login(page, "br@demo.de");
  await page.goto("/krank");
  await expect(page.getByRole("form", { name: "Krankmeldung erfassen" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Krank/ })).toHaveCount(0);
});
