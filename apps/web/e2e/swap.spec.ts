import { expect, test, type Page } from "@playwright/test";
import { db, userId } from "./db";
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

test("open offer: colleague takes it on the board, planner approves, rosters change and both are notified", async ({ page, request }) => {
  const { upcomingShifts, createSwap, canTake, cancelSwap } = await db();
  const anna = await userId("anna@demo.de");
  const shifts = await upcomingShifts(anna, 60);
  expect(shifts.length).toBeGreaterThan(3);

  // find a day and a colleague for whom taking the shift is rule-safe (the board checks rest time and free cells)
  const colleagues = ["ben", "clara", "david", "eva", "felix"];
  let chosen: { date: string; taker: string } | null = null;
  for (const s of shifts) {
    const { id } = await createSwap(anna, { date: s.date, note: "Familienfeier" });
    for (const c of colleagues) {
      if ((await canTake(id, await userId(`${c}@demo.de`))).length === 0) { chosen = { date: s.date, taker: c }; break; }
    }
    if (chosen) break;
    await cancelSwap(id, anna);
  }
  expect(chosen).not.toBeNull();
  const { date, taker } = chosen!;
  const takerName = { ben: "Ben Schmidt", clara: "Clara Wolf", david: "David Koch", eva: "Eva Richter", felix: "Felix Braun" }[taker]!;

  await login(page, `${taker}@demo.de`);
  await page.goto("/tausch");
  await expect(page.getByText("Familienfeier")).toBeVisible();
  await page.getByRole("button", { name: "Übernehmen" }).first().click();

  await login(page, "planer@demo.de");
  await page.goto("/antraege");
  const card = page.getByRole("form", { name: "Tausch Anna Becker" });
  await expect(card).toContainText(takerName);
  await expect(card).toContainText("Ruhezeiten und Arbeitstage eingehalten");
  await card.getByRole("button", { name: "Ablehnen" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Begründung");
  await page.getByRole("form", { name: "Tausch Anna Becker" }).getByRole("button", { name: "Freigeben" }).click();
  await expect(page.getByRole("form", { name: "Tausch Anna Becker" })).toHaveCount(0);

  // published roster changed for both, plan status untouched
  await page.goto(`/planer?m=${date.slice(0, 7)}`);
  await expect(page.getByText("Veröffentlicht").first()).toBeVisible();
  await expect(page.getByRole("button", { name: `Anna Becker, ${date}: frei` })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`${takerName}, ${date}: (Früh|Spät|Nacht)dienst`) })).toBeVisible();

  await login(page, "anna@demo.de");
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Tausch durchgeführt")).toBeVisible();
  // the new owner's calendar feed now contains the shift
  await login(page, `${taker}@demo.de`);
  await page.goto("/kalender");
  const ics = await (await request.get(new URL(await page.getByLabel("Kalender-Link").inputValue()).pathname)).text();
  expect(ics).toContain(`DTSTART:${date.replace(/-/g, "")}T`);
});

test("direct swap proposal through the UI shows rule problems and the partner accepts", async ({ page }) => {
  const { upcomingShifts, previewSwap, createSwap, acceptSwap, prisma } = await db();
  const ben = await userId("ben@demo.de");
  const mine = await upcomingShifts(ben, 60);
  const colleagues = await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true, id: { not: ben } }, select: { id: true, email: true } });
  // pick a date of Ben's and a colleague/shift pair the rule check marks as valid
  let pick: { date: string; partnerId: string; partnerDate: string; email: string } | null = null;
  outer: for (const m of mine.slice(0, 6)) {
    for (const c of colleagues) {
      for (const t of await upcomingShifts(c.id, 60)) {
        if (t.date !== m.date && (await previewSwap(ben, { date: m.date, partnerId: c.id, partnerDate: t.date })).length === 0) {
          pick = { date: m.date, partnerId: c.id, partnerDate: t.date, email: c.email }; break outer;
        }
      }
    }
  }
  expect(pick).not.toBeNull();
  const { id } = await createSwap(ben, { date: pick!.date, partnerId: pick!.partnerId, partnerDate: pick!.partnerDate });

  // the wrong person cannot accept
  await expect(acceptSwap(id, await userId(pick!.email === "eva@demo.de" ? "felix@demo.de" : "eva@demo.de"))).rejects.toThrow();

  await login(page, pick!.email);
  await page.goto("/tausch");
  await expect(page.getByText("Ben Schmidt").first()).toBeVisible();
  await page.getByRole("button", { name: "Zustimmen" }).click();
  await expect(page.getByRole("button", { name: "Zustimmen" })).toHaveCount(0); // action done, request left "An dich gerichtet"
  await expect(page.locator("p[role=alert]")).toHaveCount(0);
  expect((await prisma.swapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_PLANNER");

  // the requester may still withdraw, in the UI
  await login(page, "ben@demo.de");
  await page.goto("/tausch");
  await page.getByRole("button", { name: "Zurückziehen" }).first().click();
  await expect.poll(async () => (await prisma.swapRequest.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
});

test("swap pages are employee-only", async ({ page }) => {
  await login(page, "pdl@demo.de");
  await page.goto("/tausch");
  await expect(page).toHaveURL(/pruefung/);
});
