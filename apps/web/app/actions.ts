"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, setShift, submitPlan, reviewPlan, publishPlan, toDate, deliverPendingNotifications, createLeave, cancelLeave, decideLeave, applyPendingLeave, LeaveError } from "@dienstplan/db";
import { createSession, destroySession, getUser, homeFor, requireUser } from "@/lib/auth";

export async function loginAction(_: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  // compare against a dummy hash when the user is unknown to keep timing similar
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !user.active || !ok) return "E-Mail oder Passwort ist falsch.";
  await createSession(user.id);
  redirect(homeFor(user.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setShiftAction(planId: string, userId: string, date: string, shiftTypeId: string | null) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await setShift(planId, userId, me.id, date, shiftTypeId);
  revalidatePath("/planer");
}

export async function submitAction(planId: string) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await submitPlan(planId, me.id);
  await deliverPendingNotifications();
  revalidatePath("/planer");
}

export async function publishAction(planId: string) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await publishPlan(planId, me.id);
  await deliverPendingNotifications();
  revalidatePath("/planer");
  revalidatePath("/mein-plan");
}

export async function reviewAction(planId: string, decision: "APPROVED" | "REJECTED", form: FormData) {
  const me = await requireUser(["PDL", "BETRIEBSRAT"]);
  const comment = String(form.get("comment") ?? "");
  if (decision === "REJECTED" && !comment.trim()) redirect("/pruefung?err=comment");
  await reviewPlan(planId, me.id, decision, comment);
  await deliverPendingNotifications();
  revalidatePath("/pruefung");
  redirect("/pruefung");
}

export async function addPersonalAction(form: FormData) {
  const me = await requireUser();
  const date = String(form.get("date") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return;
  await prisma.personalEntry.create({ data: { userId: me.id, date: toDate(date), title: title.slice(0, 120), note: String(form.get("note") ?? "").slice(0, 500) || null } });
  revalidatePath("/mein-plan");
}

export async function deletePersonalAction(id: string) {
  const me = await requireUser();
  await prisma.personalEntry.deleteMany({ where: { id, userId: me.id } });
  revalidatePath("/mein-plan");
}

export async function markAllReadAction() {
  const me = await requireUser();
  await prisma.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/benachrichtigungen");
}

export async function regenerateCalendarAction() {
  const me = await requireUser();
  const { randomBytes } = await import("node:crypto");
  const secret = randomBytes(24).toString("hex");
  await prisma.calendarToken.upsert({ where: { userId: me.id }, update: { secret }, create: { userId: me.id, secret } });
  revalidatePath("/kalender");
}

export async function setPushEnabledAction(enabled: boolean) {
  const me = await requireUser();
  await prisma.user.update({ where: { id: me.id }, data: { pushEnabled: enabled } });
  revalidatePath("/benachrichtigungen");
}

/** Runs a leave action and turns user-facing LeaveErrors into a redirect with a message instead of an error page. */
async function leaveGuard(back: string, fn: () => Promise<unknown>) {
  let err: string | null = null;
  try { await fn(); } catch (e) { if (e instanceof LeaveError) err = e.message; else throw e; }
  await deliverPendingNotifications();
  if (err) redirect(`${back}?err=${encodeURIComponent(err)}`);
}

export async function createLeaveAction(form: FormData) {
  const me = await requireUser();
  await leaveGuard("/urlaub", () => createLeave(me.id, {
    shiftTypeId: String(form.get("type") ?? ""), start: String(form.get("start") ?? ""), end: String(form.get("end") ?? form.get("start") ?? ""), note: String(form.get("note") ?? ""),
  }));
  revalidatePath("/urlaub");
  redirect("/urlaub?ok=1");
}

export async function cancelLeaveAction(id: string) {
  const me = await requireUser();
  await leaveGuard("/urlaub", () => cancelLeave(id, me.id));
  revalidatePath("/urlaub");
}

export async function decideLeaveAction(id: string, decision: "APPROVED" | "REJECTED", form: FormData) {
  const me = await requireUser(["PLANNER", "ADMIN", "PDL"]);
  await leaveGuard("/antraege", () => decideLeave(id, me.id, decision, String(form.get("comment") ?? "")));
  revalidatePath("/antraege"); revalidatePath("/planer");
}

export async function applyLeaveAction(id: string, month: string) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await leaveGuard("/planer", () => applyPendingLeave(id, month, me.id));
  revalidatePath("/planer");
}
