"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, setShift, submitPlan, reviewPlan, publishPlan, toDate, createLeave, cancelLeave, decideLeave, setWish, deleteWish, setPreference, WishError, requestLeaveCancellation, withdrawLeaveCancellation, decideLeaveCancellation, applyPendingLeave, LeaveError,
  createSwap, acceptSwap, declineSwap, cancelSwap, decideSwap, SwapError,
  setEntitlement, setDefaultEntitlements, rolloverYear, BalanceError, changePassword, AdminError, ForbiddenError,
  createManagedUser, updateManagedUser, setManagedActive, resetManagedPassword, anonymizeUser, type Role,
  updateWardSettings, addWardHoliday, removeWardHoliday, createSickReport, extendSickReport, endSickReport, SickError } from "@dienstplan/db";
import { deliverSoon } from "@/lib/deliver";
import { createSession, destroySession, getUser, homeFor, requireUser } from "@/lib/auth";
import { dummyHash } from "@/lib/dummyHash";
import { beginLoginAttempt, clientIp, releaseAttempt, recordLoginSuccess } from "@/lib/rateLimit";

export async function loginAction(_: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = clientIp(await headers());
  const wait = beginLoginAttempt(ip, email);
  if (wait !== null) return `Zu viele Fehlversuche. Bitte versuche es in ${Math.ceil(wait / 60)} Minute(n) erneut.`;
  const user = await prisma.user.findUnique({ where: { email } });
  // compare against a dummy hash when the user is unknown to keep timing similar
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash());
  if (!user || !user.active || !ok) return "E-Mail oder Passwort ist falsch.";
  recordLoginSuccess(ip, email);
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
  deliverSoon();
  revalidatePath("/planer");
}

export async function publishAction(planId: string) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await publishPlan(planId, me.id);
  deliverSoon();
  revalidatePath("/planer");
  revalidatePath("/mein-plan");
}

export async function reviewAction(planId: string, decision: "APPROVED" | "REJECTED", form: FormData) {
  const me = await requireUser(["PDL", "BETRIEBSRAT"]);
  const comment = String(form.get("comment") ?? "");
  if (decision === "REJECTED" && !comment.trim()) redirect("/pruefung?err=comment");
  await reviewPlan(planId, me.id, decision, comment);
  deliverSoon();
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
  deliverSoon();
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

export async function requestLeaveCancellationAction(id: string, form: FormData) {
  const me = await requireUser();
  await leaveGuard("/urlaub", () => requestLeaveCancellation(id, me.id, String(form.get("reason") ?? "")));
  revalidatePath("/urlaub");
}

export async function withdrawLeaveCancellationAction(id: string) {
  const me = await requireUser();
  await leaveGuard("/urlaub", () => withdrawLeaveCancellation(id, me.id));
  revalidatePath("/urlaub");
}

export async function decideLeaveCancellationAction(id: string, decision: "APPROVED" | "REJECTED", form: FormData) {
  const me = await requireUser(["PLANNER", "ADMIN", "PDL"]);
  await leaveGuard("/antraege", () => decideLeaveCancellation(id, me.id, decision, String(form.get("comment") ?? "")));
  revalidatePath("/antraege"); revalidatePath("/planer"); revalidatePath("/mein-plan"); revalidatePath("/urlaub"); revalidatePath("/urlaubskonto");
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

/** Same pattern as leaveGuard: user-facing SwapErrors become a message on the page, anything else is a real error. */
async function swapGuard(back: string, fn: () => Promise<unknown>) {
  let err: string | null = null;
  try { await fn(); } catch (e) { if (e instanceof SwapError) err = e.message; else throw e; }
  deliverSoon();
  revalidatePath("/tausch"); revalidatePath("/antraege");
  if (err) redirect(`${back}${back.includes("?") ? "&" : "?"}err=${encodeURIComponent(err)}`);
}

export async function createSwapAction(form: FormData) {
  const me = await requireUser(["EMPLOYEE"]);
  const date = String(form.get("date") ?? "");
  const partnerId = String(form.get("partner") ?? "") || null;
  // radio value "none" = hand over without getting a shift back
  const pd = String(form.get("partnerDate") ?? "");
  await swapGuard(`/tausch/neu?date=${date}${partnerId ? `&with=${partnerId}` : ""}`, () => createSwap(me.id, { date, partnerId, partnerDate: pd && pd !== "none" ? pd : null, note: String(form.get("note") ?? "") }));
  redirect("/tausch?ok=1");
}
export async function acceptSwapAction(id: string) { const me = await requireUser(["EMPLOYEE"]); await swapGuard("/tausch", () => acceptSwap(id, me.id)); }
export async function declineSwapAction(id: string) { const me = await requireUser(["EMPLOYEE"]); await swapGuard("/tausch", () => declineSwap(id, me.id)); }
export async function cancelSwapAction(id: string) { const me = await requireUser(["EMPLOYEE"]); await swapGuard("/tausch", () => cancelSwap(id, me.id)); }
export async function decideSwapAction(id: string, decision: "APPROVED" | "REJECTED", form: FormData) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await swapGuard("/antraege", () => decideSwap(id, me.id, decision, String(form.get("comment") ?? "")));
  revalidatePath("/mein-plan");
}

async function balanceGuard(year: number, fn: () => Promise<unknown>) {
  let err: string | null = null;
  try { await fn(); } catch (e) { if (e instanceof BalanceError) err = e.message; else throw e; }
  revalidatePath("/urlaubskonto"); revalidatePath("/urlaub");
  if (err) redirect(`/urlaubskonto?y=${year}&err=${encodeURIComponent(err)}`);
}
const num = (v: FormDataEntryValue | null, fallback = 0) => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? fallback : Number(s); };

export async function saveEntitlementAction(userId: string, year: number, form: FormData) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await balanceGuard(year, () => setEntitlement(me.id, userId, year, {
    entitlement: num(form.get("entitlement")), carryOver: num(form.get("carryOver")), adjustment: num(form.get("adjustment")),
    carryOverExpires: String(form.get("carryOverExpires") ?? "") || null, note: String(form.get("note") ?? ""),
  }));
  redirect(`/urlaubskonto?y=${year}`);
}
export async function defaultEntitlementsAction(year: number, form: FormData) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await balanceGuard(year, () => setDefaultEntitlements(me.id, year, num(form.get("days"), 30)));
  redirect(`/urlaubskonto?y=${year}&ok=defaults`);
}
export async function rolloverAction(year: number, form: FormData) {
  const me = await requireUser(["PLANNER", "ADMIN"]);
  await balanceGuard(year, () => rolloverYear(me.id, year, String(form.get("expires") ?? "") || null));
  redirect(`/urlaubskonto?y=${year + 1}&ok=rollover`);
}

export async function changePasswordAction(_: string | null, form: FormData): Promise<string | null> {
  const me = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("repeat") ?? "")) return "Die beiden neuen Passwörter stimmen nicht überein.";
  const ip = clientIp(await headers());
  const wait = beginLoginAttempt(ip, me.email);
  if (wait !== null) return `Zu viele Fehlversuche. Bitte versuche es in ${Math.ceil(wait / 60)} Minute(n) erneut.`;
  try {
    await changePassword(me.id, current, next);
  } catch (e) {
    if (e instanceof AdminError) { if (!/aktuelle Passwort/.test(e.message)) releaseAttempt(ip, me.email); return e.message; }
    throw e;
  }
  recordLoginSuccess(ip, me.email);
  await createSession(me.id); // other sessions were just invalidated; keep this one signed in
  redirect("/konto?ok=1");
}

const ROLES: Role[] = ["EMPLOYEE", "PLANNER", "PDL", "BETRIEBSRAT", "ADMIN"];
const asRole = (v: FormDataEntryValue | null): Role => (ROLES.includes(String(v) as Role) ? (String(v) as Role) : "EMPLOYEE");

/** Turns expected user-management errors into a message; anything unexpected still surfaces as a real error. */
async function userGuard<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try { return { ok: await fn() }; }
  catch (e) { if (e instanceof AdminError || e instanceof ForbiddenError) return { error: e.message }; throw e; }
}

export interface UserFormState { error?: string; values?: { name: string; email: string; role: string; entitlement: string }; done?: { name: string; email: string; password: string | null; what: "created" | "reset" } }

export async function createUserAction(_: UserFormState, form: FormData): Promise<UserFormState> {
  const me = await requireUser(["ADMIN", "PLANNER"]);
  const days = String(form.get("entitlement") ?? "").trim().replace(",", ".");
  const r = await userGuard(() => createManagedUser(me.id, {
    name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), role: asRole(form.get("role")),
    password: String(form.get("password") ?? "") || undefined, entitlementDays: days === "" ? null : Number(days),
  }));
  if ("error" in r) return { error: r.error, values: { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "EMPLOYEE"), entitlement: String(form.get("entitlement") ?? "") } };
  revalidatePath("/benutzer");
  return { done: { name: r.ok.user.name, email: r.ok.user.email, password: r.ok.password, what: "created" } };
}

export async function resetUserPasswordAction(userId: string, _: UserFormState, form: FormData): Promise<UserFormState> {
  const me = await requireUser(["ADMIN", "PLANNER"]);
  const r = await userGuard(async () => ({ ...(await resetManagedPassword(me.id, userId, String(form.get("password") ?? "") || undefined)), name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") }));
  if ("error" in r) return { error: r.error };
  return { done: { name: r.ok.name, email: r.ok.email, password: r.ok.password, what: "reset" } };
}

async function backWith(result: { error: string } | { ok: unknown }, okMessage: string): Promise<never> {
  revalidatePath("/benutzer");
  redirect("error" in result ? `/benutzer?err=${encodeURIComponent(result.error)}` : `/benutzer?ok=${encodeURIComponent(okMessage)}`);
}

export async function updateUserAction(userId: string, form: FormData) {
  const me = await requireUser(["ADMIN", "PLANNER"]);
  const role = form.get("role");
  await backWith(await userGuard(() => updateManagedUser(me.id, userId, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), role: role ? asRole(role) : undefined })), "Gespeichert.");
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const me = await requireUser(["ADMIN", "PLANNER"]);
  await backWith(await userGuard(() => setManagedActive(me.id, userId, active)), active ? "Konto aktiviert." : "Konto deaktiviert. Anmeldungen, Push und offene Anträge wurden beendet.");
}

export async function anonymizeUserAction(userId: string, form: FormData) {
  const me = await requireUser(["ADMIN"]);
  const expected = String(form.get("expected") ?? "");
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== expected.toLowerCase()) await backWith({ error: "Die Bestätigung stimmt nicht mit der E-Mail-Adresse überein. Es wurde nichts geändert." }, "");
  await backWith(await userGuard(() => anonymizeUser(me.id, userId)), "Konto anonymisiert.");
}

async function settingsBack(fn: () => Promise<unknown>, ok: string): Promise<never> {
  const r = await userGuard(fn);
  revalidatePath("/", "layout"); // holidays show up on almost every page
  redirect("error" in r ? `/einstellungen?err=${encodeURIComponent(r.error)}` : `/einstellungen?ok=${encodeURIComponent(ok)}`);
}
export async function saveWardSettingsAction(form: FormData) {
  const me = await requireUser(["ADMIN"]);
  const state = String(form.get("state") ?? "");
  await settingsBack(() => updateWardSettings(me.id, {
    state: state || null, leaveCountMode: String(form.get("mode")) === "ALL_DAYS" ? "ALL_DAYS" : "WEEKDAYS", holidaysAreLeaveDays: form.get("holidaysAreLeaveDays") === "on",
    freeWishesPerMonth: String(form.get("freeWishesPerMonth") ?? "").trim() === "" ? undefined : Number(form.get("freeWishesPerMonth")),
  }), "Gespeichert. Urlaubskonten rechnen ab sofort damit.");
}
export async function addWardHolidayAction(form: FormData) {
  const me = await requireUser(["ADMIN"]);
  await settingsBack(() => addWardHoliday(me.id, { date: String(form.get("date") ?? ""), name: String(form.get("name") ?? "") }), "Freier Tag hinzugefügt.");
}
export async function removeWardHolidayAction(id: string) {
  const me = await requireUser(["ADMIN"]);
  await settingsBack(() => removeWardHoliday(me.id, id), "Freier Tag entfernt.");
}

async function sickBack(fn: () => Promise<unknown>, ok: string): Promise<never> {
  let err: string | null = null;
  try { await fn(); } catch (e) { if (e instanceof SickError || e instanceof ForbiddenError) err = e.message; else throw e; }
  if (!err) deliverSoon();
  revalidatePath("/", "layout");
  redirect(err ? `/krank?err=${encodeURIComponent(err)}` : `/krank?ok=${encodeURIComponent(ok)}`);
}
export async function createSickAction(form: FormData) {
  const me = await requireUser();
  const userId = String(form.get("userId") ?? "") || me.id;
  await sickBack(() => createSickReport(me.id, { userId, start: String(form.get("start") ?? ""), end: String(form.get("end") ?? ""), note: String(form.get("note") ?? "") }),
    userId === me.id ? "Krankmeldung gesendet. Gute Besserung!" : "Krankmeldung erfasst.");
}
export async function extendSickAction(id: string, form: FormData) {
  const me = await requireUser();
  await sickBack(() => extendSickReport(me.id, id, String(form.get("end") ?? "")), "Krankmeldung verlängert.");
}
export async function endSickAction(id: string, form: FormData) {
  const me = await requireUser();
  await sickBack(() => endSickReport(me.id, id, String(form.get("backOn") ?? "")), "Gespeichert. Die vorher geplanten Dienste stehen wieder im Plan.");
}

async function wishBack(month: string, fn: () => Promise<unknown>, ok: string): Promise<never> {
  let err: string | null = null;
  try { await fn(); } catch (e) { if (e instanceof WishError || e instanceof ForbiddenError) err = e.message; else throw e; }
  revalidatePath("/wuensche");
  redirect(`/wuensche?m=${month}&${err ? `err=${encodeURIComponent(err)}` : `ok=${encodeURIComponent(ok)}`}`);
}

export async function setWishAction(month: string, form: FormData) {
  const me = await requireUser(["EMPLOYEE"]);
  const wish = String(form.get("wish") ?? "FREE");
  await wishBack(month, () => setWish(me.id, { date: String(form.get("date") ?? ""), kind: wish === "FREE" ? "FREE" : "SHIFT", shiftTypeId: wish === "FREE" ? null : wish, note: String(form.get("note") ?? "") }), "Wunsch gespeichert.");
}

export async function deleteWishAction(id: string, month: string) {
  const me = await requireUser(["EMPLOYEE"]);
  await wishBack(month, () => deleteWish(me.id, id), "Wunsch gelöscht.");
}

export async function savePreferenceAction(form: FormData) {
  const me = await requireUser(["EMPLOYEE"]);
  const prefer: string[] = [], avoid: string[] = [];
  for (const [k, v] of form.entries()) if (k.startsWith("p_")) (v === "prefer" ? prefer : v === "avoid" ? avoid : []).push(k.slice(2));
  const month = String(form.get("m") ?? "");
  await wishBack(/^\d{4}-\d{2}$/.test(month) ? month : "", () => setPreference(me.id, { prefer, avoid, note: String(form.get("note") ?? "") }), "Vorlieben gespeichert.");
}
