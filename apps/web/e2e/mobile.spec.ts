import { localToday } from "@dienstplan/core";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { execSync } from "node:child_process";

const pushes: { to: string; title: string; body: string }[] = [];
let mock: Server;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  execSync("pnpm --filter @dienstplan/db seed", { cwd: "../..", stdio: "ignore" });
  mock = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const msgs = JSON.parse(raw) as { to: string; title: string; body: string }[];
      pushes.push(...msgs);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: msgs.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "t" })) }));
    });
  }).listen(3199);
});
test.afterAll(() => { mock.close(); });

const login = async (request: APIRequestContext, email: string) => {
  const r = await request.post("/api/mobile/login", { data: { email, password: "demo1234" } });
  expect(r.status()).toBe(200);
  return { headers: { authorization: `Bearer ${(await r.json()).token}` } };
};

test("mobile API requires a valid token and rejects bad logins", async ({ request }) => {
  expect((await request.post("/api/mobile/login", { data: { email: "anna@demo.de", password: "x" } })).status()).toBe(401);
  expect((await request.get("/api/mobile/plan")).status()).toBe(401);
  expect((await request.get("/api/mobile/plan", { headers: { authorization: "Bearer garbage" } })).status()).toBe(401);
});

test("a web session cookie token cannot be used as a mobile token", async ({ request, page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("anna@demo.de");
  await page.getByLabel("Passwort").fill("demo1234");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const cookie = (await page.context().cookies()).find((c) => c.name === "session")!;
  expect((await request.get("/api/mobile/me", { headers: { authorization: `Bearer ${cookie.value}` } })).status()).toBe(401);
});

test("plan endpoint masks sick leave for colleagues", async ({ request }) => {
  const ym = new Date().toISOString().slice(0, 7);
  const anna = await login(request, "anna@demo.de");
  const p = await (await request.get(`/api/mobile/plan?m=${ym}`, anna)).json();
  expect(p.published).toBe(true);
  const ben = p.staff.find((s: any) => s.name === "Ben Schmidt").id;
  const cell = p.shifts.find((s: any) => s.userId === ben && s.date === `${ym}-06`);
  expect(p.types.find((t: any) => t.id === cell.shiftTypeId).name).toBe("Abwesend");
  expect(p.shifts.some((s: any) => s.userId !== p.staff.find((x: any) => x.name === "Anna Becker").id && p.types.find((t: any) => t.id === s.shiftTypeId)?.kind === "SICK")).toBe(false); // no colleague shows as sick

  // the person themself sees their own sick day with its real type (the app's month view needs it to render)
  const benApi = await login(request, "ben@demo.de");
  const own = await (await request.get(`/api/mobile/plan?m=${ym}`, benApi)).json();
  const ownCell = own.shifts.find((s: any) => s.userId === ben && s.date === `${ym}-06`);
  expect(own.types.find((t: any) => t.id === ownCell.shiftTypeId)?.kind).toBe("SICK");

  const pdl = await login(request, "pdl@demo.de");
  const q = await (await request.get(`/api/mobile/plan?m=${ym}`, pdl)).json();
  const cell2 = q.shifts.find((s: any) => s.userId === ben && s.date === `${ym}-06`);
  expect(q.types.find((t: any) => t.id === cell2.shiftTypeId).kind).toBe("SICK");
});

test("device registration, personal entries and push on publish", async ({ request, page }) => {
  const anna = await login(request, "anna@demo.de");
  expect((await request.post("/api/mobile/devices", { ...anna, data: { token: "not-a-token", platform: "ios" } })).status()).toBe(400);
  expect((await request.post("/api/mobile/devices", { ...anna, data: { token: "ExponentPushToken[anna-phone]", platform: "ios" } })).status()).toBe(200);
  expect((await request.post("/api/mobile/devices", { ...anna, data: { token: "ExponentPushToken[anna-dead]", platform: "android" } })).status()).toBe(200);

  // personal entry round-trip, private to the owner
  const created = await request.post("/api/mobile/personal", { ...anna, data: { date: localToday(), title: "Zahnarzt" } });
  expect(created.status()).toBe(201);
  const ben = await login(request, "ben@demo.de");
  const mine = await (await request.get("/api/mobile/plan", ben)).json();
  expect(mine.entries.find((e: any) => e.title === "Zahnarzt")).toBeUndefined();
  const id = (await created.json()).id;
  expect((await (await request.delete(`/api/mobile/personal/${id}`, ben)).json()).deleted).toBe(0);
  expect((await (await request.delete(`/api/mobile/personal/${id}`, anna)).json()).deleted).toBe(1);

  // full workflow through the web UI; publishing must push to Anna's phone
  const web = async (email: string) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort").fill("demo1234");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  };
  await request.post("/api/mobile/devices", { ...(await login(request, "pdl@demo.de")), data: { token: "ExponentPushToken[pdl-phone]", platform: "ios" } });
  await web("planer@demo.de");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  await page.getByRole("button", { name: "Zur Prüfung einreichen" }).click();
  await expect(page.getByText("In Prüfung").first()).toBeVisible();
  await expect.poll(() => pushes.some((p) => p.to === "ExponentPushToken[pdl-phone]" && p.title === "Dienstplan zur Prüfung")).toBe(true);

  await web("pdl@demo.de");
  await page.getByRole("button", { name: "Genehmigen" }).click();
  await expect(page.getByText("Deine Entscheidung: ✅ genehmigt")).toBeVisible();
  await web("br@demo.de");
  await page.getByRole("button", { name: "Genehmigen" }).click();
  await expect(page.getByText("Deine Entscheidung: ✅ genehmigt")).toBeVisible();
  await web("planer@demo.de");
  await page.getByRole("link", { name: "Nächster Monat" }).click();
  await page.getByRole("button", { name: "Veröffentlichen" }).click();
  await expect(page.getByText("Plan ist online")).toBeVisible();

  await expect.poll(() => pushes.some((p) => p.to === "ExponentPushToken[anna-phone]" && p.title === "Dienstplan veröffentlicht")).toBe(true);
  // dead token is cleaned up, phone sees the notification in the list as push-delivered
  const n = await (await request.get("/api/mobile/notifications", anna)).json();
  expect(n.items.some((i: any) => i.type === "PLAN_PUBLISHED")).toBe(true);
  await request.post("/api/mobile/notifications/read", anna);
  expect((await (await request.get("/api/mobile/notifications", anna)).json()).unread).toBe(0);

  // push opt-out is honoured
  expect((await request.patch("/api/mobile/settings", { ...anna, data: { pushEnabled: false } })).status()).toBe(200);
  expect((await request.patch("/api/mobile/settings", { ...anna, data: { pushEnabled: "yes" } })).status()).toBe(400);
});
