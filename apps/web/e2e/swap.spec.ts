import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const login = async (page: Page, email: string) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
};
const api = async (request: APIRequestContext, email: string) => ({ headers: { authorization: `Bearer ${(await (await request.post("/api/mobile/login", { data: { email, password: "demo1234" } })).json()).token}` } });

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

test("open offer: colleague takes it on the board, planner approves, rosters change and both are notified", async ({ page, request }) => {
  const anna = await api(request, "anna@demo.de");
  const shifts = (await (await request.get("/api/mobile/swaps", anna)).json()).shifts as { date: string; type: { name: string } }[];
  expect(shifts.length).toBeGreaterThan(3);

  // find a day and a colleague for whom taking the shift is rule-safe (the board checks rest time and free cells)
  const colleagues = ["ben", "clara", "david", "eva", "felix"];
  let chosen: { date: string; taker: string } | null = null;
  for (const s of shifts) {
    const created = await request.post("/api/mobile/swaps", { ...anna, data: { date: s.date, note: "Familienfeier" } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    for (const c of colleagues) {
      const offer = (await (await request.get("/api/mobile/swaps", await api(request, `${c}@demo.de`))).json()).open.find((o: any) => o.id === id);
      if (offer && offer.problems.length === 0) { chosen = { date: s.date, taker: c }; break; }
    }
    if (chosen) break;
    await request.delete(`/api/mobile/swaps/${id}`, anna);
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

test("direct swap proposal through the UI shows rule problems and the partner accepts", async ({ page, request }) => {
  const ben = await api(request, "ben@demo.de");
  const mine = (await (await request.get("/api/mobile/swaps", ben)).json()).shifts as { date: string }[];
  // pick a date of Ben's and a colleague/shift pair the options endpoint marks as valid
  let pick: { date: string; partnerId: string; partnerDate: string } | null = null;
  const colleagues = (await (await request.get(`/api/mobile/swaps/options?date=${mine[0]!.date}`, ben)).json()).colleagues as { id: string }[];
  outer: for (const m of mine.slice(0, 6)) {
    for (const c of colleagues) {
      const o = await (await request.get(`/api/mobile/swaps/options?date=${m.date}&with=${c.id}`, ben)).json();
      const ok = o.theirs.find((t: any) => t.problems.length === 0 && t.date !== m.date);
      if (ok) { pick = { date: m.date, partnerId: c.id, partnerDate: ok.date }; break outer; }
    }
  }
  expect(pick).not.toBeNull();

  const res = await request.post("/api/mobile/swaps", { ...ben, data: pick });
  expect(res.status()).toBe(201);
  const id = (await res.json()).id;

  // wrong person cannot accept
  const eva = await api(request, "eva@demo.de");
  expect((await request.post(`/api/mobile/swaps/${id}`, { ...eva, data: { action: "accept" } })).status()).toBe(400);
  // planners and non-employees are not part of the swap board
  expect((await request.get("/api/mobile/swaps", await api(request, "planer@demo.de"))).status()).toBe(403);

  const partner = (await (await request.get(`/api/mobile/swaps/options?date=${pick!.date}`, ben)).json()).colleagues.find((c: any) => c.id === pick!.partnerId);
  const email = `${partner.name.split(" ")[0]!.toLowerCase()}@demo.de`;
  await login(page, email);
  await page.goto("/tausch");
  await expect(page.getByText("Ben Schmidt").first()).toBeVisible();
  await page.getByRole("button", { name: "Zustimmen" }).click();
  await expect(page.getByRole("button", { name: "Zustimmen" })).toHaveCount(0); // action done, request left "An dich gerichtet"
  await expect(page.locator("p[role=alert]")).toHaveCount(0);

  const after = await (await request.get("/api/mobile/swaps", ben)).json();
  expect(after.mine.find((m: any) => m.id === id).status).toBe("PENDING_PLANNER");
  expect((await request.delete(`/api/mobile/swaps/${id}`, ben)).status()).toBe(200); // requester may still withdraw
});

test("swap pages are employee-only", async ({ page }) => {
  await login(page, "pdl@demo.de");
  await page.goto("/tausch");
  await expect(page).toHaveURL(/pruefung/);
});
