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

/** First Monday of next month and the Friday of that week (5 counted weekdays). */
const week = () => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const mon = d.toISOString().slice(0, 10);
  const fri = new Date(d.getTime() + 4 * 86_400_000).toISOString().slice(0, 10);
  return { mon, fri, year: Number(mon.slice(0, 4)), thu: new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10) };
};

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

test("employees see their balance; lapsed carry-over is shown", async ({ page }) => {
  const y = new Date().getUTCFullYear();
  await login(page, "clara@demo.de");
  await page.goto("/urlaub");
  await expect(page.getByRole("heading", { name: `Resturlaub ${y}` })).toBeVisible();
  await expect(page.getByText("2 verfallen")).toBeVisible();
  await expect(page.getByText("von 30 Tage")).toBeVisible();
  await expect(page.getByText("Unbezahlter Urlaub und Sonderurlaub werden nicht abgezogen")).toBeVisible();
});

test("planner sets an entitlement; requests above the remaining days are refused; deciders see the impact", async ({ page }) => {
  const w = week();
  await login(page, "planer@demo.de");
  await page.goto(`/urlaubskonto?y=${w.year}`);
  // entitlement of 3 days for Felix
  await page.getByRole("row", { name: /Felix Braun/ }).getByText(/Ändern|Anlegen/).click();
  const form = page.getByRole("form", { name: "Anspruch Felix Braun" });
  await form.getByLabel("Jahresanspruch (Tage)").fill("3");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("row", { name: /Felix Braun/ }).getByRole("cell").first()).toHaveText("3"); // Anspruch column, after the redirect

  // invalid input is rejected with a message
  await page.getByRole("row", { name: /Felix Braun/ }).getByText("Ändern").click();
  await page.getByRole("form", { name: "Anspruch Felix Braun" }).getByLabel("Jahresanspruch (Tage)").fill("30,3");
  await page.getByRole("form", { name: "Anspruch Felix Braun" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("halbe Tage");

  await login(page, "felix@demo.de");
  await page.goto("/urlaub");
  await page.getByLabel("Art").selectOption({ label: "Urlaub" });
  await page.getByLabel("Von").fill(w.mon);
  await page.getByLabel("Bis").fill(w.fri);
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(`Nicht genug Resturlaub ${w.year}: 3 Tag(e) verfügbar, 5 beantragt`);

  // unpaid leave for the same week is not limited by the balance
  await page.getByLabel("Art").selectOption({ label: "Unbezahlter Urlaub (unbezahlt)" });
  await page.getByLabel("Von").fill(w.mon);
  await page.getByLabel("Bis").fill(w.fri);
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  // 3 paid days (Mon–Wed) fit exactly: they must not overlap the open unpaid request, so use another week
  const later = new Date(Date.parse(`${w.mon}T00:00:00Z`) + 14 * 86_400_000);
  const from = later.toISOString().slice(0, 10), to = new Date(later.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  if (from.startsWith(String(w.year))) {
    await page.getByLabel("Art").selectOption({ label: "Urlaub" });
    await page.getByLabel("Von").fill(from);
    await page.getByLabel("Bis").fill(to);
    await page.getByRole("button", { name: "Antrag senden" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("heading", { name: `Resturlaub ${w.year}` })).toBeVisible();

    // the PDL sees what approving would do
    await login(page, "pdl@demo.de");
    await page.goto("/antraege");
    // only the paid request shows a balance impact: 3 days requested, 0 left after approval
    const paid = page.getByRole("form", { name: "Antrag Felix Braun" }).filter({ hasText: /Rest nach Genehmigung/ });
    await expect(paid).toHaveCount(1);
    await expect(paid).toContainText(`Urlaub ${w.year}: 3 Tag(e) beantragt · Rest nach Genehmigung 0 Tag(e)`);
  }
});

test("PDL can read the Urlaubskonto but not edit it; employees cannot open it", async ({ page }) => {
  await login(page, "pdl@demo.de");
  await page.goto("/urlaubskonto");
  await expect(page.getByRole("row", { name: /Anna Becker/ })).toBeVisible();
  await expect(page.getByText("Ändern")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Durchführen" })).toHaveCount(0);
  await login(page, "anna@demo.de");
  await page.goto("/urlaubskonto");
  await expect(page).toHaveURL(/mein-plan/);
});

test("rollover creates next year with the remaining days as carry-over", async ({ page }) => {
  const y = new Date().getUTCFullYear();
  await login(page, "planer@demo.de");
  await page.goto(`/urlaubskonto?y=${y}`);
  const cells = page.getByRole("row", { name: /Anna Becker/ }).getByRole("cell");
  const remaining = (await cells.nth(5).innerText()).trim(); // "Rest" column, whatever the demo data currently yields
  expect(Number(remaining.replace(",", "."))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Durchführen" }).click();
  await expect(page.getByRole("status")).toContainText("Jahreswechsel durchgeführt");
  await expect(page.getByRole("heading", { name: `Urlaubskonto ${y + 1}` })).toBeVisible();
  const next = page.getByRole("row", { name: /Anna Becker/ }).getByRole("cell");
  await expect(next.nth(0)).toHaveText("30"); // same entitlement
  await expect(next.nth(1)).toHaveText(new RegExp(`^${remaining}( ⚠.*)?$`)); // remaining days became the carry-over (with the lapse warning)
  // running it again changes nothing
  await page.goto(`/urlaubskonto?y=${y}`);
  await page.getByRole("button", { name: "Durchführen" }).click();
  await expect(page.getByRole("row", { name: /Anna Becker/ }).getByRole("cell").nth(1)).toHaveText(new RegExp(`^${remaining}`));
});

test("mobile API returns the balance with the leave info", async ({ request }) => {
  const r = await request.post("/api/mobile/login", { data: { email: "anna@demo.de", password: "demo1234" } });
  const info = await (await request.get("/api/mobile/leave", { headers: { authorization: `Bearer ${(await r.json()).token}` } })).json();
  const b = info.balances.find((x: any) => x.year === new Date().getUTCFullYear());
  expect(b).toMatchObject({ configured: true, total: 30 });
  expect(b.planned).toBeGreaterThan(0); // seeded Urlaub is counted as planned
  expect(b.remaining).toBe(30 - b.taken - b.planned - b.approvedHeld - b.requested);
});
