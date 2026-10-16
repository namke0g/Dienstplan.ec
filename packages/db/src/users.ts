import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Prisma, Role, User } from "@prisma/client";
import { AdminError, checkPassword, generatePassword, normEmail } from "./admin";
import { prisma } from "./client";
import { actor, ForbiddenError, type Tx } from "./service";
import { endBrowserPush } from "./push";

const MANAGERS: Role[] = ["ADMIN", "PLANNER"];
const ALL_ROLES: Role[] = ["EMPLOYEE", "PLANNER", "PDL", "BETRIEBSRAT", "ADMIN"];

/** Admins manage everyone; planners only employee accounts (never other roles, never themselves). */
export const assignableRoles = (role: Role): Role[] => (role === "ADMIN" ? ALL_ROLES : role === "PLANNER" ? ["EMPLOYEE"] : []);
const canTouch = (a: User, target: { role: Role; wardId: string; id: string }) =>
  a.wardId === target.wardId && (a.role === "ADMIN" || (a.role === "PLANNER" && target.role === "EMPLOYEE" && a.id !== target.id));

async function manager(tx: Tx, actorId: string) {
  return actor(tx, actorId, MANAGERS);
}
async function target(tx: Tx, a: User, id: string) {
  const t = await tx.user.findUnique({ where: { id } });
  if (!t || !canTouch(a, t)) throw new ForbiddenError("Dieses Konto darfst du nicht verwalten.");
  if (t.anonymizedAt) throw new AdminError("Dieses Konto wurde anonymisiert und kann nicht mehr bearbeitet werden.");
  return t;
}
const log = (tx: Tx, actorId: string, targetId: string | null, action: string, detail?: Prisma.InputJsonValue) =>
  tx.userAudit.create({ data: { actorId, targetId, action, detail } });

async function activeAdmins(tx: Tx, wardId: string) {
  return tx.user.count({ where: { wardId, role: "ADMIN", active: true } });
}

export async function listManagedUsers(actorId: string) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  if (!MANAGERS.includes(me.role)) throw new ForbiddenError("Keine Berechtigung");
  const users = await prisma.user.findMany({
    where: { wardId: me.wardId, ...(me.role === "PLANNER" ? { role: "EMPLOYEE" } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, anonymizedAt: true },
  });
  return { me, users, roles: assignableRoles(me.role) };
}

export interface NewUser { name: string; email: string; role: Role; password?: string; entitlementDays?: number | null }

export async function createManagedUser(actorId: string, input: NewUser) {
  const email = normEmail(input.email);
  const name = input.name.trim();
  if (!name) throw new AdminError("Der Name darf nicht leer sein.");
  const password = input.password || generatePassword();
  checkPassword(password);
  const hash = await bcrypt.hash(password, 12);
  return prisma.$transaction(async (tx) => {
    const me = await manager(tx, actorId);
    if (!assignableRoles(me.role).includes(input.role)) throw new ForbiddenError("Diese Rolle darfst du nicht vergeben.");
    if (await tx.user.findUnique({ where: { email } })) throw new AdminError(`Es gibt bereits ein Konto für ${email}.`);
    const user = await tx.user.create({ data: { email, name, role: input.role, wardId: me.wardId, passwordHash: hash } });
    await tx.calendarToken.create({ data: { userId: user.id, secret: randomBytes(24).toString("hex") } });
    if (input.role === "EMPLOYEE" && input.entitlementDays != null) {
      if (!(input.entitlementDays >= 0 && input.entitlementDays <= 366 && Math.round(input.entitlementDays * 2) === input.entitlementDays * 2)) throw new AdminError("Der Urlaubsanspruch muss zwischen 0 und 366 Tagen liegen (halbe Tage erlaubt).");
      await tx.leaveEntitlement.create({ data: { userId: user.id, year: new Date().getUTCFullYear(), entitlement: input.entitlementDays } });
    }
    await log(tx, actorId, user.id, "CREATED", { role: user.role });
    return { user, password: input.password ? null : password };
  });
}

export async function updateManagedUser(actorId: string, userId: string, input: { name: string; email: string; role?: Role }) {
  const email = normEmail(input.email);
  const name = input.name.trim();
  if (!name) throw new AdminError("Der Name darf nicht leer sein.");
  return prisma.$transaction(async (tx) => {
    const me = await manager(tx, actorId);
    const t = await target(tx, me, userId);
    const role = input.role ?? t.role;
    if (role !== t.role) {
      if (t.id === me.id) throw new AdminError("Du kannst deine eigene Rolle nicht ändern.");
      if (!assignableRoles(me.role).includes(role)) throw new ForbiddenError("Diese Rolle darfst du nicht vergeben.");
      if (t.role === "ADMIN" && t.active && (await activeAdmins(tx, t.wardId)) <= 1) throw new AdminError("Es muss mindestens ein aktiver Admin bleiben.");
    }
    if (email !== t.email && (await tx.user.findUnique({ where: { email } }))) throw new AdminError(`Es gibt bereits ein Konto für ${email}.`);
    const changed = { name: name !== t.name, email: email !== t.email, role: role !== t.role };
    await tx.user.update({
      where: { id: t.id },
      // a changed role or e-mail ends existing sessions, so permissions take effect immediately
      data: { name, email, role, ...(changed.role || changed.email ? { sessionsValidAfter: new Date() } : {}) },
    });
    if (changed.role || changed.email) await endBrowserPush(t.id, tx);
    await log(tx, actorId, t.id, "UPDATED", { changed, from: { role: t.role, email: t.email }, to: { role, email } });
  });
}

/** Deactivation ends sessions, stops push, and withdraws open requests; the person stays visible on past rosters. */
export async function setManagedActive(actorId: string, userId: string, active: boolean) {
  return prisma.$transaction(async (tx) => {
    const me = await manager(tx, actorId);
    const t = await target(tx, me, userId);
    if (!active) {
      if (t.id === me.id) throw new AdminError("Du kannst dein eigenes Konto nicht deaktivieren.");
      if (t.role === "ADMIN" && t.active && (await activeAdmins(tx, t.wardId)) <= 1) throw new AdminError("Es muss mindestens ein aktiver Admin bleiben.");
      await tx.deviceToken.deleteMany({ where: { userId: t.id } });
      const leave = await tx.leaveRequest.updateMany({ where: { userId: t.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      const swaps = await tx.swapRequest.updateMany({ where: { OR: [{ requesterId: t.id }, { partnerId: t.id }], status: { in: ["OPEN", "PENDING_PARTNER", "PENDING_PLANNER"] } }, data: { status: "CANCELLED" } });
      await tx.user.update({ where: { id: t.id }, data: { active: false, sessionsValidAfter: new Date() } });
      await log(tx, actorId, t.id, "DEACTIVATED", { cancelledLeave: leave.count, cancelledSwaps: swaps.count });
    } else {
      await tx.user.update({ where: { id: t.id }, data: { active: true } });
      await log(tx, actorId, t.id, "ACTIVATED");
    }
  });
}

export async function resetManagedPassword(actorId: string, userId: string, password?: string) {
  const pw = password || generatePassword();
  checkPassword(pw);
  const hash = await bcrypt.hash(pw, 12);
  return prisma.$transaction(async (tx) => {
    const me = await manager(tx, actorId);
    const t = await target(tx, me, userId);
    if (t.id === me.id) throw new AdminError("Dein eigenes Passwort änderst du unter „Mein Konto“.");
    await tx.user.update({ where: { id: t.id }, data: { passwordHash: hash, sessionsValidAfter: new Date() } });
    await endBrowserPush(t.id, tx);
    await log(tx, actorId, t.id, "PASSWORD_RESET");
    return { password: password ? null : pw };
  });
}

/**
 * For people who left: removes the personal data but keeps the roster history (shifts stay, attributed to "Ehemalige Person").
 * Irreversible; only admins, only for deactivated accounts.
 */
export async function anonymizeUser(actorId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    const t = await tx.user.findUnique({ where: { id: userId } });
    if (!t || t.wardId !== me.wardId) throw new ForbiddenError("Dieses Konto darfst du nicht verwalten.");
    if (t.anonymizedAt) throw new AdminError("Das Konto ist bereits anonymisiert.");
    if (t.active) throw new AdminError("Nur deaktivierte Konten können anonymisiert werden. Bitte zuerst deaktivieren.");
    const n = (await tx.user.count({ where: { wardId: t.wardId, anonymizedAt: { not: null } } })) + 1;
    await tx.personalEntry.deleteMany({ where: { userId: t.id } });
    await tx.deviceToken.deleteMany({ where: { userId: t.id } });
    await tx.calendarToken.deleteMany({ where: { userId: t.id } });
    await tx.notification.deleteMany({ where: { userId: t.id } });
    await tx.leaveEntitlement.deleteMany({ where: { userId: t.id } });
    await tx.leaveRequest.updateMany({ where: { userId: t.id }, data: { note: null, decisionComment: null } });
    await tx.swapRequest.updateMany({ where: { OR: [{ requesterId: t.id }, { partnerId: t.id }] }, data: { note: null } });
    await tx.user.update({
      where: { id: t.id },
      data: {
        name: `Ehemalige Person ${n}`, email: `anonymisiert-${t.id}@invalid.local`, passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
        active: false, pushEnabled: false, anonymizedAt: new Date(), sessionsValidAfter: new Date(),
      },
    });
    await log(tx, actorId, t.id, "ANONYMIZED");
  });
}
