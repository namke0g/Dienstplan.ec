import { PrismaClient, type Role, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","Notification","CalendarToken","DeviceToken","PersonalEntry","Approval","Shift","LeaveEntitlement","WardHoliday","Plan","ShiftType","User","Ward" CASCADE`,
  );
  const ward = await prisma.ward.create({ data: { name: "Station 3A – Innere Medizin", state: "NW" } });
  const hash = await bcrypt.hash("demo1234", 10);
  const people: [string, string, Role][] = [
    ["admin@demo.de", "Admin", "ADMIN"],
    ["planer@demo.de", "Petra Planer", "PLANNER"],
    ["pdl@demo.de", "Paul Dienstleitung (PDL)", "PDL"],
    ["br@demo.de", "Britta Rat (Betriebsrat)", "BETRIEBSRAT"],
    ["anna@demo.de", "Anna Becker", "EMPLOYEE"],
    ["ben@demo.de", "Ben Schmidt", "EMPLOYEE"],
    ["clara@demo.de", "Clara Wolf", "EMPLOYEE"],
    ["david@demo.de", "David Koch", "EMPLOYEE"],
    ["eva@demo.de", "Eva Richter", "EMPLOYEE"],
    ["felix@demo.de", "Felix Braun", "EMPLOYEE"],
  ];
  const users: User[] = [];
  for (const [email, name, role] of people) {
    users.push(await prisma.user.create({ data: { email, name, role, passwordHash: hash, wardId: ward.id } }));
  }
  for (const u of users) await prisma.calendarToken.create({ data: { userId: u.id, secret: randomBytes(24).toString("hex") } });

  const types = {
    F: await prisma.shiftType.create({ data: { wardId: ward.id, code: "F", name: "Frühdienst", startMin: 360, endMin: 870, color: "#f59e0b" } }),
    S: await prisma.shiftType.create({ data: { wardId: ward.id, code: "S", name: "Spätdienst", startMin: 780, endMin: 1290, color: "#6366f1" } }),
    N: await prisma.shiftType.create({ data: { wardId: ward.id, code: "N", name: "Nachtdienst", startMin: 1260, endMin: 420, color: "#0f172a" } }),
  };

  const absence = (code: string, name: string, kind: "VACATION" | "SPECIAL_LEAVE" | "SICK", paid: boolean, color: string) =>
    prisma.shiftType.create({ data: { wardId: ward.id, code, name, kind, paid, consumesLeave: kind === "VACATION" && paid, startMin: 0, endMin: 0, color } });
  const abs = {} as Record<string, string>;
  for (const a of [
    absence("U", "Urlaub", "VACATION", true, "#10b981"),
    absence("UU", "Unbezahlter Urlaub", "VACATION", false, "#64748b"),
    absence("K", "Krank (mit Entgeltfortzahlung)", "SICK", true, "#e11d48"),
    absence("KU", "Krank (ohne Entgelt)", "SICK", false, "#9f1239"),
    absence("SU", "Sonderurlaub", "SPECIAL_LEAVE", true, "#0ea5e9"),
  ]) { const t = await a; abs[t.code] = t.id; }

  // Rotating demo roster for staff: 2 weeks of the current month published, next month as draft.
  const staff = users.filter((u) => u.role === "EMPLOYEE");
  const mk = async (month: string, publish: boolean) => {
    const plan = await prisma.plan.create({
      data: { wardId: ward.id, month: d(`${month}-01`), status: publish ? "PUBLISHED" : "DRAFT" },
    });
    const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
    const order = [types.F, types.F, types.S, types.S, types.N, null, null] as const;
    const rows: { planId: string; userId: string; shiftTypeId: string; date: Date }[] = [];
    for (let day = 1; day <= last; day++) {
      staff.forEach((u, i) => {
        let t: { id: string } | null = order[(day + i * 2) % 7];
        if (i === 0 && day >= 20 && day <= 24) t = { id: abs.U! }; // Anna: Urlaub
        if (i === 1 && (day === 6 || day === 7)) t = { id: abs.K! }; // Ben: krank
        if (i === 2 && day === 12) t = { id: abs.SU! }; // Clara: Sonderurlaub
        if (t) rows.push({ planId: plan.id, userId: u.id, shiftTypeId: t.id, date: d(`${month}-${String(day).padStart(2, "0")}`) });
      });
    }
    await prisma.shift.createMany({ data: rows });
    if (publish) {
      const shifts = await prisma.shift.findMany({ where: { planId: plan.id } });
      await prisma.plan.update({
        where: { id: plan.id },
        data: {
          publishedAt: new Date(),
          publishedVersion: 1,
          publishedSnapshot: shifts.map((s) => ({ id: s.id, userId: s.userId, date: s.date.toISOString().slice(0, 10), shiftTypeId: s.shiftTypeId, sequence: 0 })),
        },
      });
      for (const role of ["PDL", "BETRIEBSRAT"] as const) {
        const by = users.find((u) => u.role === role)!;
        await prisma.approval.create({ data: { planId: plan.id, version: 1, role, decision: "APPROVED", decidedAt: new Date(), decidedById: by.id } });
      }
    }
  };
  const now = new Date();
  const cur = now.toISOString().slice(0, 7);
  const nextD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await mk(cur, true);
  await mk(nextD.toISOString().slice(0, 7), false);
  // demo balances for the current year: 30 days; Clara has 2 carry-over days that lapsed on 31 March
  const year = now.getUTCFullYear();
  for (const u of staff) {
    await prisma.leaveEntitlement.create({
      data: { userId: u.id, year, entitlement: 30, carryOver: u.email === "clara@demo.de" ? 2 : 0, carryOverExpires: u.email === "clara@demo.de" ? d(`${year}-03-31`) : null },
    });
  }
  console.log("Seeded. Login with any e-mail above, password: demo1234");
}

main().finally(() => prisma.$disconnect());
