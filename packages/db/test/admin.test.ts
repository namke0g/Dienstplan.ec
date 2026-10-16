import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma, bootstrap, createUser, resetPassword, setActive, listUsers, AdminError, generatePassword } from "../src";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "AuditLog","Notification","CalendarToken","DeviceToken","PersonalEntry","Approval","Shift","LeaveEntitlement","Plan","ShiftType","User","Ward" CASCADE`);
});

describe("production bootstrap and user administration", () => {
  it("creates ward, default types and the first admin on an empty database, and refuses to run twice", async () => {
    await expect(bootstrap({ wardName: "Station 1", adminEmail: "not-an-email", adminName: "A" })).rejects.toBeInstanceOf(AdminError);
    await expect(bootstrap({ wardName: "Station 1", adminEmail: "a@k.de", adminName: "A", adminPassword: "short" })).rejects.toThrow(/mindestens 12/);
    const r = await bootstrap({ wardName: " Station 1 ", adminEmail: "Admin@Klinik.DE", adminName: "Ada Admin" });
    expect(r.ward.name).toBe("Station 1");
    expect(r.admin).toMatchObject({ email: "admin@klinik.de", role: "ADMIN" });
    expect(r.password).toHaveLength(16);
    expect(await bcrypt.compare(r.password!, r.admin.passwordHash)).toBe(true);
    const types = await prisma.shiftType.findMany();
    expect(types.map((t) => t.code).sort()).toEqual(["F", "K", "KU", "N", "S", "SU", "U", "UU"]);
    expect(types.filter((t) => t.consumesLeave).map((t) => t.code)).toEqual(["U"]);
    expect(await prisma.calendarToken.count()).toBe(1);
    expect(await prisma.plan.count()).toBe(0); // no demo data
    await expect(bootstrap({ wardName: "Zweite", adminEmail: "b@k.de", adminName: "B" })).rejects.toThrow(/bereits eingerichtet/);
  });

  it("creates users with generated or given passwords, roles and a calendar token; rejects duplicates and weak input", async () => {
    const a = await createUser({ email: "Anna@Klinik.de", name: "Anna Becker", role: "EMPLOYEE" });
    expect(a.user.email).toBe("anna@klinik.de");
    expect(a.password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(await prisma.calendarToken.count({ where: { userId: a.user.id } })).toBe(1);
    const p = await createUser({ email: "pdl@klinik.de", name: "Paul PDL", role: "PDL", password: "ein-langes-passwort" });
    expect(p.password).toBeNull(); // given passwords are never echoed back
    await expect(createUser({ email: "anna@klinik.de", name: "Doppelt", role: "EMPLOYEE" })).rejects.toThrow(/bereits ein Konto/);
    await expect(createUser({ email: "x@klinik.de", name: "X", role: "EMPLOYEE", password: "kurz" })).rejects.toThrow(/mindestens/);
    await expect(createUser({ email: "x@klinik.de", name: " ", role: "EMPLOYEE" })).rejects.toThrow(/Name/);
  });

  it("resets passwords, deactivates and reactivates accounts", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { email: "anna@klinik.de" } })).passwordHash;
    const r = await resetPassword("anna@klinik.de");
    const after = await prisma.user.findUniqueOrThrow({ where: { email: "anna@klinik.de" } });
    expect(after.passwordHash).not.toBe(before);
    expect(await bcrypt.compare(r.password!, after.passwordHash)).toBe(true);
    await expect(resetPassword("nobody@klinik.de")).rejects.toThrow(/Kein Konto/);
    await setActive("anna@klinik.de", false);
    expect((await listUsers()).find((u) => u.email === "anna@klinik.de")?.active).toBe(false);
    await setActive("anna@klinik.de", true);
    expect((await listUsers()).find((u) => u.email === "anna@klinik.de")?.active).toBe(true);
  });

  it("generated passwords avoid look-alike characters and differ", () => {
    const pws = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(pws.size).toBe(50);
    for (const p of pws) expect(p).not.toMatch(/[0OIl1]/);
  });
});

import { changePassword, sessionStillValid } from "../src";

describe("password change and session invalidation", () => {
  it("needs the current password, enforces the policy and invalidates older sessions", async () => {
    const u = (await createUser({ email: "pw@klinik.de", name: "Pia Pw", role: "EMPLOYEE", password: "altes-passwort-1" })).user;
    await expect(changePassword(u.id, "falsch-falsch-1", "neues-passwort-1")).rejects.toThrow(/aktuelle Passwort ist falsch/);
    await expect(changePassword(u.id, "altes-passwort-1", "kurz")).rejects.toThrow(/mindestens 12/);
    await expect(changePassword(u.id, "altes-passwort-1", "altes-passwort-1")).rejects.toThrow(/unterscheiden/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionsValidAfter).toBeNull();

    await changePassword(u.id, "altes-passwort-1", "neues-passwort-1");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare("neues-passwort-1", after.passwordHash)).toBe(true);
    const cutoff = Math.floor(after.sessionsValidAfter!.getTime() / 1000);
    expect(sessionStillValid(after.sessionsValidAfter, cutoff - 60)).toBe(false); // token from before the change
    expect(sessionStillValid(after.sessionsValidAfter, cutoff + 1)).toBe(true); // token from the new login
    expect(sessionStillValid(after.sessionsValidAfter, undefined)).toBe(false);
    expect(sessionStillValid(null, undefined)).toBe(true); // never changed: no restriction
  });

  it("an operator password reset also logs everyone out", async () => {
    await resetPassword("pw@klinik.de");
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "pw@klinik.de" } });
    expect(u.sessionsValidAfter).not.toBeNull();
  });
});
