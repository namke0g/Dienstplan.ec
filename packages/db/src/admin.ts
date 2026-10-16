import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "./client";

export class AdminError extends Error {}

export const MIN_PASSWORD = 12;
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters

export const generatePassword = (len = 16) => Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export function checkPassword(pw: string) {
  if (pw.length < MIN_PASSWORD) throw new AdminError(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
}
export const normEmail = (e: string) => {
  const email = e.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AdminError(`Ungültige E-Mail-Adresse: ${e}`);
  return email;
};

/** Default shift and absence types of a new ward (same as the demo data, without any people or plans). */
const DEFAULT_TYPES = [
  { code: "F", name: "Frühdienst", startMin: 360, endMin: 870, color: "#f59e0b", kind: "WORK", paid: true, consumesLeave: false },
  { code: "S", name: "Spätdienst", startMin: 780, endMin: 1290, color: "#6366f1", kind: "WORK", paid: true, consumesLeave: false },
  { code: "N", name: "Nachtdienst", startMin: 1260, endMin: 420, color: "#0f172a", kind: "WORK", paid: true, consumesLeave: false },
  { code: "U", name: "Urlaub", startMin: 0, endMin: 0, color: "#10b981", kind: "VACATION", paid: true, consumesLeave: true },
  { code: "UU", name: "Unbezahlter Urlaub", startMin: 0, endMin: 0, color: "#64748b", kind: "VACATION", paid: false, consumesLeave: false },
  { code: "K", name: "Krank (mit Entgeltfortzahlung)", startMin: 0, endMin: 0, color: "#e11d48", kind: "SICK", paid: true, consumesLeave: false },
  { code: "KU", name: "Krank (ohne Entgelt)", startMin: 0, endMin: 0, color: "#9f1239", kind: "SICK", paid: false, consumesLeave: false },
  { code: "SU", name: "Sonderurlaub", startMin: 0, endMin: 0, color: "#0ea5e9", kind: "SPECIAL_LEAVE", paid: true, consumesLeave: false },
] as const;

async function newUser(tx: Pick<typeof prisma, "user" | "calendarToken">, d: { email: string; name: string; role: Role; wardId: string; password: string }) {
  const user = await tx.user.create({ data: { email: d.email, name: d.name.trim(), role: d.role, wardId: d.wardId, passwordHash: await bcrypt.hash(d.password, 12) } });
  await tx.calendarToken.create({ data: { userId: user.id, secret: randomBytes(24).toString("hex") } });
  return user;
}

/** First-time setup of an empty database: one ward, its shift types and the first admin. Refuses to run twice. */
export async function bootstrap(input: { wardName: string; adminEmail: string; adminName: string; adminPassword?: string }) {
  if (!input.wardName.trim() || !input.adminName.trim()) throw new AdminError("Stationsname und Name des Admins dürfen nicht leer sein.");
  const email = normEmail(input.adminEmail);
  const password = input.adminPassword ?? generatePassword();
  checkPassword(password);
  return prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0 || (await tx.ward.count()) > 0) throw new AdminError("Die Datenbank ist bereits eingerichtet. Weitere Personen legst du mit create-user an.");
    const ward = await tx.ward.create({ data: { name: input.wardName.trim() } });
    await tx.shiftType.createMany({ data: DEFAULT_TYPES.map((t) => ({ ...t, wardId: ward.id })) });
    const admin = await newUser(tx, { email, name: input.adminName, role: "ADMIN", wardId: ward.id, password });
    return { ward, admin, password: input.adminPassword ? null : password };
  });
}

export async function createUser(input: { email: string; name: string; role: Role; password?: string; wardId?: string }) {
  const email = normEmail(input.email);
  if (!input.name.trim()) throw new AdminError("Der Name darf nicht leer sein.");
  const password = input.password ?? generatePassword();
  checkPassword(password);
  const wards = await prisma.ward.findMany();
  const ward = input.wardId ? wards.find((w) => w.id === input.wardId) : wards.length === 1 ? wards[0] : undefined;
  if (!ward) throw new AdminError(wards.length === 0 ? "Es gibt noch keine Station. Zuerst bootstrap ausführen." : "Mehrere Stationen vorhanden: wardId angeben.");
  if (await prisma.user.findUnique({ where: { email } })) throw new AdminError(`Es gibt bereits ein Konto für ${email}.`);
  const user = await prisma.$transaction((tx) => newUser(tx, { email, name: input.name, role: input.role, wardId: ward.id, password }));
  return { user, password: input.password ? null : password };
}

export async function resetPassword(emailIn: string, password?: string) {
  const email = normEmail(emailIn);
  const pw = password ?? generatePassword();
  checkPassword(pw);
  const { count } = await prisma.user.updateMany({ where: { email }, data: { passwordHash: await bcrypt.hash(pw, 12), active: true, sessionsValidAfter: new Date() } });
  if (!count) throw new AdminError(`Kein Konto für ${email}.`);
  return { password: password ? null : pw };
}

export async function setActive(emailIn: string, active: boolean) {
  const { count } = await prisma.user.updateMany({ where: { email: normEmail(emailIn) }, data: { active } });
  if (!count) throw new AdminError(`Kein Konto für ${emailIn}.`);
}

export const listUsers = () => prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }], select: { email: true, name: true, role: true, active: true } });

/** Self-service: needs the current password; all other sessions and app tokens stop working. */
export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw new AdminError("Das aktuelle Passwort ist falsch.");
  checkPassword(next);
  if (next === current) throw new AdminError("Das neue Passwort muss sich vom aktuellen unterscheiden.");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 12), sessionsValidAfter: new Date() } });
}

/**
 * Token timestamps have one-second resolution, so the cutoff is the first full second after the change: a token issued earlier in
 * the same second as the change must not survive.
 */
export const sessionCutoff = (validAfter: Date) => Math.floor(validAfter.getTime() / 1000) + 1;

/** True if a token issued at `iat` (seconds) is still valid for this user. */
export const sessionStillValid = (validAfter: Date | null, iat: number | undefined) => !validAfter || (iat !== undefined && iat >= sessionCutoff(validAfter));

/** The `iat` to put into a new token: now, but never before the user's cutoff (otherwise a login right after a change would be rejected). */
export const tokenIssuedAt = (validAfter: Date | null, nowMs = Date.now()) => Math.max(Math.floor(nowMs / 1000), validAfter ? sessionCutoff(validAfter) : 0);
