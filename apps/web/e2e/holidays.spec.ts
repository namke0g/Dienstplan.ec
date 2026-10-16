import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { holidayMap } from "@dienstplan/core";

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
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The next Mon–Fri week (within the next year) that contains exactly one NRW holiday on a weekday. */
function weekWithOneHoliday() {
  const d = new Date(Date.now() + 7 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 60; i++, d.setUTCDate(d.getUTCDate() + 7)) {
    const mon = iso(d), fri = iso(new Date(d.getTime() + 4 * 86_400_000));
    const h = holidayMap(mon, fri, "NW");
    if (h.size === 1 && mon.slice(0, 4) === fri.slice(0, 4)) return { mon, fri, year: Number(mon.slice(0, 4)), holiday: [...h][0]! };
  }
  throw new Error("no such week found");
}

test("admins see the state's holidays and manage local extra days; others cannot open the settings", async ({ page }) => {
  await login(page, "admin@demo.de");
  await page.goto("/einstellungen");
  await expect(page.getByLabel(/Bundesland/)).toHaveValue("NW");
  await expect(page.getByText("Allerheiligen")).toBeVisible();
  await expect(page.getByText("Heilige Drei Könige")).toHaveCount(0);

  await page.getByLabel(/Bundesland/).selectOption("BY");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Gespeichert");
  await expect(page.getByText("Heilige Drei Könige")).toBeVisible();

  const form = page.getByRole("form", { name: "Freien Tag hinzufügen" });
  await form.getByLabel("Datum").fill(`${new Date().getUTCFullYear()}-08-15`);
  await form.getByLabel("Bezeichnung").fill("Mariä Himmelfahrt");
  await form.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByRole("status")).toContainText("hinzugefügt");
  await page.getByRole("form", { name: "Freien Tag hinzufügen" }).getByLabel("Datum").fill(`${new Date().getUTCFullYear()}-08-15`);
  await page.getByRole("form", { name: "Freien Tag hinzufügen" }).getByLabel("Bezeichnung").fill("doppelt");
  await page.getByRole("form", { name: "Freien Tag hinzufügen" }).getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("schon einen Eintrag");
  await page.getByRole("button", { name: "Mariä Himmelfahrt entfernen" }).click();
  await expect(page.getByRole("status")).toContainText("entfernt");

  // back to NRW for the other tests
  await page.getByLabel(/Bundesland/).selectOption("NW");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  for (const email of ["planer@demo.de", "pdl@demo.de", "anna@demo.de"]) {
    await login(page, email);
    await page.goto("/einstellungen");
    await expect(page).not.toHaveURL(/einstellungen/);
  }
});

test("holidays are marked in the roster and are not deducted from leave", async ({ page, request }) => {
  const w = weekWithOneHoliday();
  const [hDate, hName] = w.holiday;

  await login(page, "planer@demo.de");
  await page.goto(`/planer?m=${hDate.slice(0, 7)}`);
  await expect(page.locator("th", { hasText: `Feiertag: ${hName}` })).toHaveCount(1);
  await expect(page.getByText(new RegExp(`Feiertage:.*${hName}`))).toBeVisible();

  // Felix requests that Mon–Fri week: 4 leave days, not 5
  await page.goto(`/urlaubskonto?y=${w.year}`);
  await page.getByRole("row", { name: /Felix Braun/ }).getByText(/Ändern|Anlegen/).click();
  await page.getByRole("form", { name: "Anspruch Felix Braun" }).getByLabel("Jahresanspruch (Tage)").fill("30");
  await page.getByRole("form", { name: "Anspruch Felix Braun" }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("row", { name: /Felix Braun/ }).getByRole("cell").first()).toHaveText("30");

  const token = (await (await request.post("/api/mobile/login", { data: { email: "felix@demo.de", password: "demo1234" } })).json()).token;
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const info = await (await request.get("/api/mobile/leave", auth)).json();
  const urlaub = info.types.find((t: { name: string }) => t.name === "Urlaub").id;
  expect((await request.post("/api/mobile/leave", { ...auth, data: { typeId: urlaub, start: w.mon, end: w.fri } })).status()).toBe(201);
  const b = (await (await request.get("/api/mobile/leave", auth)).json()).balances.find((x: { year: number }) => x.year === w.year);
  expect(b.requested).toBe(4);

  // the phone app gets the holidays of the month too
  const plan = await (await request.get(`/api/mobile/plan?m=${hDate.slice(0, 7)}`, auth)).json();
  expect(plan.holidays).toEqual(expect.arrayContaining([{ date: hDate, name: hName }]));
});
