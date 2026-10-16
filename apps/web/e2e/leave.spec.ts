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
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" }); });

test("employee requests leave, PDL approves, it lands in the draft roster; rejection needs a reason", async ({ page }) => {
  // next month is a seeded DRAFT, so approval is applied immediately
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() + 1, 10);
  const from = start.toISOString().slice(0, 10);
  const to = new Date(start.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const ym = from.slice(0, 7);

  await login(page, "clara@demo.de");
  await page.goto("/urlaub");
  await page.getByLabel("Art").selectOption({ label: "Urlaub" });
  await page.getByLabel("Von").fill(from);
  await page.getByLabel("Bis").fill(to);
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.getByRole("status")).toContainText("Antrag gesendet");
  await expect(page.getByText("Offen", { exact: true })).toBeVisible();

  // an overlapping second request is refused with a message
  await page.getByLabel("Art").selectOption({ label: "Urlaub" });
  await page.getByLabel("Von").fill(to);
  await page.getByLabel("Bis").fill(to);
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("überschneidet");

  // Sonderurlaub without a reason is refused
  await page.getByLabel("Art").selectOption({ label: "Sonderurlaub" });
  await page.getByLabel("Von").fill(plusDays(40));
  await page.getByLabel("Bis").fill(plusDays(40));
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Grund");

  // the employee cannot open the inbox
  await page.goto("/antraege");
  await expect(page).toHaveURL(/mein-plan/);

  // PDL sees the request with context and approves
  await login(page, "pdl@demo.de");
  await page.goto("/antraege");
  const card = page.getByRole("form", { name: "Antrag Clara Wolf" });
  await expect(card).toContainText("ersetzt"); // seeded rotation already has shifts on those days
  await card.getByRole("button", { name: "Ablehnen" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Begründung");
  await page.getByRole("form", { name: "Antrag Clara Wolf" }).getByRole("button", { name: "Genehmigen" }).click();
  await expect(page.getByText("Keine offenen Anträge")).toBeVisible();

  // planner sees the absence in the draft roster
  await login(page, "planer@demo.de");
  await page.goto(`/planer?m=${ym}`);
  await expect(page.getByRole("button", { name: `Clara Wolf, ${from}: Urlaub` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Clara Wolf, ${to}: Urlaub` })).toBeVisible();

  // employee sees the decision
  await login(page, "clara@demo.de");
  await page.goto("/urlaub");
  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Antrag genehmigt")).toBeVisible();
});

test("approved leave for a published month is held until the planner applies it", async ({ page }) => {
  const t0 = plusDays(0);
  const d = plusDays(2).startsWith(t0.slice(0, 7)) ? plusDays(2) : t0; // stay inside the (published) current month
  const ym = d.slice(0, 7);
  await login(page, "eva@demo.de");
  await page.goto("/urlaub");
  await page.getByLabel("Art").selectOption({ label: "Urlaub" });
  await page.getByLabel("Von").fill(d);
  await page.getByLabel("Bis").fill(d);
  await page.getByRole("button", { name: "Antrag senden" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await login(page, "planer@demo.de");
  await page.goto("/antraege");
  await page.getByRole("form", { name: "Antrag Eva Richter" }).getByRole("button", { name: "Genehmigen" }).click();
  await page.goto(`/planer?m=${ym}`);
  await expect(page.getByText("noch nicht im Plan stehen")).toBeVisible();
  await expect(page.getByRole("button", { name: `Eva Richter, ${d}: Urlaub` })).toHaveCount(0);
  await page.getByRole("button", { name: "In Plan übernehmen" }).click();
  await expect(page.getByRole("button", { name: `Eva Richter, ${d}: Urlaub` })).toBeVisible();
  await expect(page.getByText("noch nicht im Plan stehen")).toHaveCount(0);
  await expect(page.getByText("Entwurf")).toBeVisible(); // new plan version, needs re-approval
});

test("mobile API: create, list, cancel and validation errors", async ({ request }) => {
  const r = await request.post("/api/mobile/login", { data: { email: "felix@demo.de", password: "demo1234" } });
  const auth = { headers: { authorization: `Bearer ${(await r.json()).token}` } };
  const info = await (await request.get("/api/mobile/leave", auth)).json();
  expect(info.types.map((t: any) => t.name).sort()).toEqual(["Sonderurlaub", "Unbezahlter Urlaub", "Urlaub"]);
  const urlaub = info.types.find((t: any) => t.name === "Urlaub").id;

  const bad = await request.post("/api/mobile/leave", { ...auth, data: { typeId: urlaub, start: "2020-01-01", end: "2020-01-02" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toMatch(/Vergangenheit/);

  const ok = await request.post("/api/mobile/leave", { ...auth, data: { typeId: urlaub, start: plusDays(60), end: plusDays(62) } });
  expect(ok.status()).toBe(201);
  const created = await ok.json();
  expect(created.status).toBe("PENDING");

  const other = await request.post("/api/mobile/login", { data: { email: "david@demo.de", password: "demo1234" } });
  const otherAuth = { headers: { authorization: `Bearer ${(await other.json()).token}` } };
  expect((await request.delete(`/api/mobile/leave/${created.id}`, otherAuth)).status()).toBe(400); // not theirs
  expect((await request.delete(`/api/mobile/leave/${created.id}`, auth)).status()).toBe(200);
  const after = await (await request.get("/api/mobile/leave", auth)).json();
  expect(after.requests.find((x: any) => x.id === created.id).status).toBe("CANCELLED");
  expect((await request.get("/api/mobile/leave")).status()).toBe(401);
});
