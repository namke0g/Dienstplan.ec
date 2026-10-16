import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","Notification","CalendarToken","DeviceToken","PersonalEntry","Approval","Shift","Plan","ShiftType","User","Ward" CASCADE`,
  );
  const ward = await prisma.ward.create({ data: { name: "Station 3A – Innere Medizin" } });
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
  const users = [];
  for (const [email, name, role] of people) {
    users.push(await prisma.user.create({ data: { email, name, role, passwordHash: hash, wardId: ward.id } }));
  }
  for (const u of users) await prisma.calendarToken.create({ data: { userId: u.id, secret: randomBytes(24).toString("hex") } });

  const types = {
    F: await prisma.shiftType.create({ data: { wardId: ward.id, code: "F", name: "Frühdienst", startMin: 360, endMin: 870, color: "#f59e0b" } }),
    S: await prisma.shiftType.create({ data: { wardId: ward.id, code: "S", name: "Spätdienst", startMin: 780, endMin: 1290, color: "#6366f1" } }),
    N: await prisma.shiftType.create({ data: { wardId: ward.id, code: "N", name: "Nachtdienst", startMin: 1260, endMin: 420, color: "#0f172a" } }),
  };

  // Rotating demo roster for staff: 2 weeks of the current month published, next month as draft.
  const staff = users.filter((u) => u.role === "EMPLOYEE");
  const mk = async (month: string, publish: boolean) => {
    const plan = await prisma.plan.create({
      data: { wardId: ward.id, month: d(`${month}-01`), status: publish ? "PUBLISHED" : "DRAFT" },
    });
    const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
    const order = [types.F, types.F, types.S, types.S, types.N, null, null] as const;
    const rows = [];
    for (let day = 1; day <= last; day++) {
      staff.forEach((u, i) => {
        const t = order[(day + i * 2) % 7];
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
  console.log("Seeded. Login with any e-mail above, password: demo1234");
}

main().finally(() => prisma.$disconnect());
