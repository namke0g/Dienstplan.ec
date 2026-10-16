import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import bcrypt from "bcryptjs";
import {
  prisma, createManagedUser, updateManagedUser, setManagedActive, resetManagedPassword, anonymizeUser, listManagedUsers, assignableRoles,
  AdminError, ForbiddenError, createLeave, sessionStillValid,
} from "../src";

let admin: string, planner: string, pdl: string, br: string, anna: string, ben: string;
const id = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
const get = (userId: string) => prisma.user.findUniqueOrThrow({ where: { id: userId } });

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  [admin, planner, pdl, br, anna, ben] = await Promise.all(["admin", "planer", "pdl", "br", "anna", "ben"].map(id));
});

describe("who may manage which accounts", () => {
  it("admins may assign every role, planners only employee, everyone else nothing", () => {
    expect(assignableRoles("ADMIN")).toHaveLength(5);
    expect(assignableRoles("PLANNER")).toEqual(["EMPLOYEE"]);
    expect(assignableRoles("PDL")).toEqual([]);
    expect(assignableRoles("EMPLOYEE")).toEqual([]);
  });

  it("listing: admins see everybody, planners only employees, others are refused", async () => {
    expect((await listManagedUsers(admin)).users.length).toBeGreaterThanOrEqual(10);
    const p = await listManagedUsers(planner);
    expect(p.users.every((u) => u.role === "EMPLOYEE")).toBe(true);
    expect(p.roles).toEqual(["EMPLOYEE"]);
    await expect(listManagedUsers(pdl)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listManagedUsers(anna)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("create", () => {
  it("creates accounts with a generated one-time password, calendar token and optional leave entitlement", async () => {
    const r = await createManagedUser(admin, { name: " Nora Neu ", email: "Nora@Demo.de", role: "EMPLOYEE", entitlementDays: 28.5 });
    expect(r.user).toMatchObject({ name: "Nora Neu", email: "nora@demo.de", role: "EMPLOYEE", active: true });
    expect(r.password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(await bcrypt.compare(r.password!, r.user.passwordHash)).toBe(true);
    expect(await prisma.calendarToken.count({ where: { userId: r.user.id } })).toBe(1);
    expect((await prisma.leaveEntitlement.findFirstOrThrow({ where: { userId: r.user.id } })).entitlement).toBe(28.5);
    const own = await createManagedUser(admin, { name: "Otto Own", email: "otto@demo.de", role: "PDL", password: "ein-langes-passwort" });
    expect(own.password).toBeNull();
    expect(await prisma.leaveEntitlement.count({ where: { userId: own.user.id } })).toBe(0); // only for employees
  });

  it("enforces roles, uniqueness and input rules", async () => {
    await expect(createManagedUser(planner, { name: "X", email: "x1@demo.de", role: "PLANNER" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createManagedUser(planner, { name: "X", email: "x2@demo.de", role: "ADMIN" })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await createManagedUser(planner, { name: "Emil Employee", email: "emil@demo.de", role: "EMPLOYEE" });
    expect(ok.user.role).toBe("EMPLOYEE");
    await expect(createManagedUser(pdl, { name: "X", email: "x3@demo.de", role: "EMPLOYEE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createManagedUser(anna, { name: "X", email: "x4@demo.de", role: "EMPLOYEE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createManagedUser(admin, { name: "Dup", email: "ANNA@demo.de", role: "EMPLOYEE" })).rejects.toThrow(/bereits ein Konto/);
    await expect(createManagedUser(admin, { name: "  ", email: "x5@demo.de", role: "EMPLOYEE" })).rejects.toThrow(/Name/);
    await expect(createManagedUser(admin, { name: "X", email: "kaputt", role: "EMPLOYEE" })).rejects.toThrow(/Ungültige E-Mail/);
    await expect(createManagedUser(admin, { name: "X", email: "x6@demo.de", role: "EMPLOYEE", password: "kurz" })).rejects.toThrow(/mindestens 12/);
    await expect(createManagedUser(admin, { name: "X", email: "x7@demo.de", role: "EMPLOYEE", entitlementDays: 30.3 })).rejects.toThrow(/halbe Tage/);
    expect(await prisma.user.count({ where: { email: { startsWith: "x" } } })).toBe(0); // failed creations leave nothing behind
  });
});

describe("update", () => {
  it("changes name, e-mail and role; a role or e-mail change ends the person's sessions", async () => {
    const u = (await createManagedUser(admin, { name: "Rolf Rolle", email: "rolf@demo.de", role: "EMPLOYEE" })).user;
    await updateManagedUser(admin, u.id, { name: "Rolf Rolle-Neu", email: "rolf@demo.de" });
    expect((await get(u.id)).sessionsValidAfter).toBeNull(); // name only: stays signed in
    await updateManagedUser(admin, u.id, { name: "Rolf Rolle-Neu", email: "rolf@demo.de", role: "PLANNER" });
    const after = await get(u.id);
    expect(after.role).toBe("PLANNER");
    expect(sessionStillValid(after.sessionsValidAfter, Math.floor(Date.now() / 1000) - 60)).toBe(false);
    await expect(updateManagedUser(admin, u.id, { name: "x", email: "anna@demo.de" })).rejects.toThrow(/bereits ein Konto/);
  });

  it("planners cannot change roles or touch non-employees; nobody changes their own role", async () => {
    await expect(updateManagedUser(planner, anna, { name: "Anna", email: "anna@demo.de", role: "PLANNER" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateManagedUser(planner, pdl, { name: "PDL", email: "pdl@demo.de" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateManagedUser(planner, admin, { name: "A", email: "admin@demo.de" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateManagedUser(admin, admin, { name: "Admin", email: "admin@demo.de", role: "EMPLOYEE" })).rejects.toThrow(/eigene Rolle/);
    await updateManagedUser(planner, anna, { name: "Anna Becker-Meier", email: "anna@demo.de" }); // name for an employee is fine
    expect((await get(anna)).name).toBe("Anna Becker-Meier");
  });

  it("an admin can be demoted by another admin only while another active admin remains", async () => {
    const second = (await createManagedUser(admin, { name: "Zweiter Admin", email: "admin2@demo.de", role: "ADMIN" })).user;
    await updateManagedUser(admin, second.id, { name: "Zweiter Admin", email: "admin2@demo.de", role: "EMPLOYEE" }); // admin keeps working
    expect((await get(second.id)).role).toBe("EMPLOYEE");
    expect(await prisma.user.count({ where: { role: "ADMIN", active: true } })).toBe(1);
  });
});

describe("deactivate / reactivate", () => {
  it("ends sessions, stops push, withdraws open requests and keeps the person on the roster", async () => {
    await prisma.deviceToken.create({ data: { userId: ben, platform: "IOS", token: "ExponentPushToken[ben-x]" } });
    const wardId = (await get(ben)).wardId;
    const type = (await prisma.shiftType.findFirstOrThrow({ where: { wardId, code: "U" } })).id;
    const leave = await createLeave(ben, { shiftTypeId: type, start: "2036-05-04", end: "2036-05-05" }, "2036-01-02");
    const shiftsBefore = await prisma.shift.count({ where: { userId: ben } });

    await setManagedActive(planner, ben, false);
    const b = await get(ben);
    expect(b.active).toBe(false);
    expect(sessionStillValid(b.sessionsValidAfter, Math.floor(Date.now() / 1000) - 60)).toBe(false);
    expect(await prisma.deviceToken.count({ where: { userId: ben } })).toBe(0);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe("CANCELLED");
    expect(await prisma.shift.count({ where: { userId: ben } })).toBe(shiftsBefore); // roster history untouched
    const entry = await prisma.userAudit.findFirstOrThrow({ where: { targetId: ben, action: "DEACTIVATED" } });
    expect(entry.actorId).toBe(planner);
    expect(entry.detail).toMatchObject({ cancelledLeave: 1 });

    await setManagedActive(planner, ben, true);
    expect((await get(ben)).active).toBe(true);
  });

  it("guards: not yourself, planners only employees", async () => {
    await expect(setManagedActive(admin, admin, false)).rejects.toThrow(/eigenes Konto/);
    await expect(setManagedActive(planner, pdl, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setManagedActive(planner, planner, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setManagedActive(br, anna, false)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reset password", () => {
  it("sets a one-time password and signs the person out; not for yourself", async () => {
    const before = (await get(anna)).passwordHash;
    const r = await resetManagedPassword(planner, anna);
    const a = await get(anna);
    expect(a.passwordHash).not.toBe(before);
    expect(await bcrypt.compare(r.password!, a.passwordHash)).toBe(true);
    expect(a.sessionsValidAfter).not.toBeNull();
    expect((await resetManagedPassword(admin, anna, "mein-eigenes-pw-123")).password).toBeNull();
    await expect(resetManagedPassword(admin, admin)).rejects.toThrow(/Mein Konto/);
    await expect(resetManagedPassword(planner, pdl)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resetManagedPassword(admin, anna, "kurz")).rejects.toThrow(/mindestens 12/);
  });
});

describe("anonymise", () => {
  it("removes personal data of a deactivated person but keeps roster history; irreversible; admin only", async () => {
    const eva = await id("eva");
    await prisma.personalEntry.create({ data: { userId: eva, date: new Date("2036-01-01T00:00:00Z"), title: "Arzttermin" } });
    await prisma.deviceToken.create({ data: { userId: eva, platform: "ANDROID", token: "ExponentPushToken[eva-x]" } });
    const shifts = await prisma.shift.count({ where: { userId: eva } });
    expect(shifts).toBeGreaterThan(0);

    await expect(anonymizeUser(admin, eva)).rejects.toThrow(/deaktiviert/); // must be deactivated first
    await setManagedActive(admin, eva, false);
    await expect(anonymizeUser(planner, eva)).rejects.toBeInstanceOf(ForbiddenError);
    await anonymizeUser(admin, eva);

    const e = await get(eva);
    expect(e.name).toMatch(/^Ehemalige Person \d+$/);
    expect(e.email).toBe(`anonymisiert-${eva}@invalid.local`);
    expect(e.active).toBe(false);
    expect(e.anonymizedAt).not.toBeNull();
    expect(await prisma.personalEntry.count({ where: { userId: eva } })).toBe(0);
    expect(await prisma.deviceToken.count({ where: { userId: eva } })).toBe(0);
    expect(await prisma.calendarToken.count({ where: { userId: eva } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: eva } })).toBe(0);
    expect(await prisma.leaveEntitlement.count({ where: { userId: eva } })).toBe(0);
    expect(await prisma.shift.count({ where: { userId: eva } })).toBe(shifts); // history stays
    expect(await bcrypt.compare("demo1234", e.passwordHash)).toBe(false); // old password is gone for good
    expect(await prisma.userAudit.count({ where: { targetId: eva, action: "ANONYMIZED" } })).toBe(1);

    await expect(anonymizeUser(admin, eva)).rejects.toThrow(/bereits anonymisiert/);
    await expect(setManagedActive(admin, eva, true)).rejects.toThrow(/anonymisiert/);
    await expect(resetManagedPassword(admin, eva)).rejects.toThrow(/anonymisiert/);
    await expect(updateManagedUser(admin, eva, { name: "Zurück", email: "eva@demo.de" })).rejects.toThrow(/anonymisiert/);
  });

  it("swap requests of a deactivated person are withdrawn", async () => {
    const clara = await id("clara");
    // no published plan far in the future for this test, so just check the status filter path via a direct row
    const wardId = (await get(clara)).wardId;
    const type = (await prisma.shiftType.findFirstOrThrow({ where: { wardId, code: "F" } })).id;
    const row = await prisma.swapRequest.create({ data: { wardId, requesterId: clara, date: new Date("2036-02-02T00:00:00Z"), shiftTypeId: type, status: "OPEN" } });
    await setManagedActive(admin, clara, false);
    expect((await prisma.swapRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CANCELLED");
  });
});
