import type { Prisma, Role } from "@prisma/client";
import { eachDay, monthsBetween, rangesOverlap, validateLeaveRange, localToday } from "@dienstplan/core";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { actor, applyShift, ForbiddenError, loadState, type Tx } from "./service";
import { assertEnoughLeave } from "./balance";
import { writeRosterCells } from "./rosterCells";

const DECIDERS: Role[] = ["PLANNER", "ADMIN", "PDL"];
const REQUESTABLE = ["VACATION", "SPECIAL_LEAVE"] as const;
const todayYmd = () => localToday(); // the ward's local date, not UTC

export class LeaveError extends Error {}

const dmy = (d: string) => d.split("-").reverse().join(".");

async function notifyDeciders(tx: Tx, wardId: string, title: string, body: string) {
  const users = await tx.user.findMany({ where: { wardId, active: true, role: { in: ["PLANNER", "PDL"] } } });
  await tx.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: "LEAVE_REQUESTED", title, body })) });
}

export async function createLeave(userId: string, input: { shiftTypeId: string; start: string; end: string; note?: string }, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    // overlap and balance checks hold under double taps / two devices
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`leave:${userId}`}))) AS l`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const type = await tx.shiftType.findFirst({ where: { id: input.shiftTypeId, wardId: user.wardId } });
    if (!type || !(REQUESTABLE as readonly string[]).includes(type.kind)) throw new LeaveError("Diese Abwesenheitsart kann nicht beantragt werden.");
    const err = validateLeaveRange(input.start, input.end, today);
    if (err) throw new LeaveError(err);
    const note = input.note?.trim().slice(0, 500) || null;
    if (type.kind === "SPECIAL_LEAVE" && !note) throw new LeaveError("Bitte gib für Sonderurlaub einen Grund an.");

    const mine = await tx.leaveRequest.findMany({ where: { userId, status: { in: ["PENDING", "APPROVED"] }, end: { gte: toDate(input.start) }, start: { lte: toDate(input.end) } } });
    if (mine.some((r) => rangesOverlap({ start: toYmd(r.start), end: toYmd(r.end) }, input))) throw new LeaveError("Der Zeitraum überschneidet sich mit einem bestehenden Antrag.");

    if (type.consumesLeave) {
      const short = await assertEnoughLeave(tx, userId, input.start, input.end, today);
      if (short) throw new LeaveError(short);
    }
    const req = await tx.leaveRequest.create({ data: { userId, shiftTypeId: type.id, start: toDate(input.start), end: toDate(input.end), note } });
    await notifyDeciders(tx, user.wardId, "Neuer Abwesenheitsantrag", `${user.name}: ${type.name} ${dmy(input.start)}–${dmy(input.end)}`);
    return req;
  });
}

export async function cancelLeave(id: string, userId: string) {
  const { count } = await prisma.leaveRequest.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!count) throw new LeaveError("Nur offene eigene Anträge können zurückgezogen werden.");
}

/**
 * Give back approved leave that has not started yet. Approved leave binds both sides, so this is a request: the leave stays
 * in the plan until a planner/PDL agrees.
 */
export async function requestLeaveCancellation(id: string, userId: string, reason: string, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({ where: { id }, include: { user: true, shiftType: true } });
    if (!req || req.userId !== userId || req.status !== "APPROVED") throw new LeaveError("Nur eigener genehmigter Urlaub kann zurückgegeben werden.");
    if (req.cancelRequestedAt) throw new LeaveError("Die Rückgabe ist bereits beantragt.");
    if (toYmd(req.start) <= today) throw new LeaveError("Bereits begonnene Abwesenheiten können nicht mehr zurückgegeben werden. Bitte sprich mit der Planung.");
    const why = reason.trim().slice(0, 500);
    if (!why) throw new LeaveError("Bitte gib einen Grund für die Rückgabe an.");
    const { count } = await tx.leaveRequest.updateMany({ where: { id, status: "APPROVED", cancelRequestedAt: null }, data: { cancelRequestedAt: new Date(), cancelReason: why } });
    if (!count) throw new LeaveError("Die Rückgabe ist bereits beantragt.");
    await notifyDeciders(tx, req.user.wardId, "Rückgabe von Urlaub beantragt", `${req.user.name}: ${req.shiftType.name} ${dmy(toYmd(req.start))}–${dmy(toYmd(req.end))}`);
  });
}

/**
 * What the employee sees: approved leave with an open return request shows as such (until the leave starts: then the request has
 * lapsed and the leave simply stands), and leave given back with consent is "returned", not "withdrawn".
 */
export function leaveDisplayStatus(r: { status: string; start: Date; cancelRequestedAt: Date | null; cancelledAt: Date | null }, today = todayYmd()) {
  if (r.status === "CANCELLED" && r.cancelledAt) return "RETURNED" as const;
  if (r.status === "APPROVED" && r.cancelRequestedAt && toYmd(r.start) > today) return "RETURN_REQUESTED" as const;
  return r.status as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
}

/** Open return requests for the deciders of a ward (lapsed ones, whose leave has begun, are left out). */
export function openLeaveReturns(wardId: string, today = todayYmd()) {
  return prisma.leaveRequest.findMany({
    where: { user: { wardId }, status: "APPROVED", cancelRequestedAt: { not: null }, start: { gt: toDate(today) } },
    orderBy: { start: "asc" }, include: { user: { select: { name: true } }, shiftType: true },
  });
}

/** The employee takes back their own open cancellation request (the leave stays as approved). */
export async function withdrawLeaveCancellation(id: string, userId: string) {
  const { count } = await prisma.leaveRequest.updateMany({ where: { id, userId, status: "APPROVED", cancelRequestedAt: { not: null } }, data: { cancelRequestedAt: null, cancelReason: null } });
  if (!count) throw new LeaveError("Es gibt keine offene Rückgabe zu diesem Antrag.");
}

/**
 * Planner/PDL decides a cancellation request. Agreeing frees the days in the roster: draft and published copy, each only while it
 * still shows this leave (a planner's later change stays). Days count as leave again in the balance only while they are in the
 * roster, so the days are credited back at once. A freed day is simply free: new shifts on it go through the normal plan approval.
 */
export async function decideLeaveCancellation(id: string, actorId: string, decision: "APPROVED" | "REJECTED", comment?: string, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, DECIDERS);
    const req = await tx.leaveRequest.findUnique({ where: { id }, include: { user: true, shiftType: true } });
    if (!req) throw new LeaveError("Antrag nicht gefunden.");
    if (req.user.wardId !== me.wardId) throw new ForbiddenError("Antrag gehört zu einer anderen Station");
    if (req.status !== "APPROVED" || !req.cancelRequestedAt) throw new LeaveError("Zu diesem Antrag ist keine Rückgabe offen.");
    const what = `${req.shiftType.name} ${dmy(toYmd(req.start))}–${dmy(toYmd(req.end))}`;

    if (decision === "REJECTED") {
      if (!comment?.trim()) throw new LeaveError("Eine Ablehnung braucht eine Begründung.");
      const { count } = await tx.leaveRequest.updateMany({ where: { id, status: "APPROVED", cancelRequestedAt: { not: null } }, data: { cancelRequestedAt: null, cancelReason: null } });
      if (!count) throw new LeaveError("Zu diesem Antrag ist keine Rückgabe offen.");
      await tx.notification.create({ data: { userId: req.userId, type: "LEAVE_DECIDED", title: "Rückgabe abgelehnt", body: `${what} bleibt genehmigt: ${comment.trim()}` } });
      return { freed: 0 };
    }

    if (toYmd(req.start) <= today) throw new LeaveError("Die Abwesenheit hat schon begonnen und kann nicht mehr zurückgegeben werden.");
    const days = eachDay(toYmd(req.start), toYmd(req.end)).filter((d) => !req.pendingMonths.includes(d.slice(0, 7))); // pending months never reached the roster
    const inReview = await tx.plan.count({ where: { wardId: req.user.wardId, status: "IN_REVIEW", month: { in: [...new Set(days.map((d) => toDate(`${d.slice(0, 7)}-01`)))] } } });
    if (inReview) throw new LeaveError("Der Plan ist gerade in Prüfung. Bitte nach der Entscheidung zustimmen.");
    // claim first: two deciders clicking at once must not both free the days
    const { count } = await tx.leaveRequest.updateMany({
      where: { id, status: "APPROVED", cancelRequestedAt: { not: null } },
      data: { status: "CANCELLED", cancelledById: me.id, cancelledAt: new Date(), pendingMonths: [] },
    });
    if (!count) throw new LeaveError("Zu diesem Antrag ist keine Rückgabe offen.");
    let freed = 0;
    if (days.length) {
      await writeRosterCells(tx, req.user.wardId, days.map((date) => ({
        userId: req.userId, date,
        value: (now) => {
          const v = { draft: now.draft === req.shiftTypeId ? null : undefined, published: now.published === req.shiftTypeId ? null : undefined };
          if (v.draft === null || v.published === null) freed++;
          return v;
        },
      })), { actorId, action: "LEAVE_CANCELLED", detail: { leaveRequestId: id, userId: req.userId, days } });
    }
    // days now covered by a sick report keep the sick entry; when that report ends, those days must come back free, not as leave
    const sick = await tx.sickReport.findMany({ where: { userId: req.userId, start: { lte: req.end }, end: { gte: req.start } } });
    for (const r of sick) {
      const replaced = (r.replaced as unknown as { date: string; draft: string | null; published?: string | null }[]).map((x) =>
        !days.includes(x.date) ? x : { ...x, draft: x.draft === req.shiftTypeId ? null : x.draft, ...(x.published !== undefined ? { published: x.published === req.shiftTypeId ? null : x.published } : {}) });
      await tx.sickReport.update({ where: { id: r.id }, data: { replaced: replaced as unknown as Prisma.InputJsonValue } });
    }
    await tx.notification.create({ data: { userId: req.userId, type: "LEAVE_DECIDED", title: "Rückgabe genehmigt", body: `${what} ist zurückgegeben. Die Tage sind wieder frei.` } });
    return { freed };
  });
}

/** Writes the leave into the roster of one month. Returns how many existing cells with a different entry were replaced. */
async function applyMonth(tx: Tx, req: { id: string; userId: string; shiftTypeId: string; start: Date; end: Date }, month: string, wardId: string, actorId: string) {
  const plan = await tx.plan.upsert({ where: { wardId_month: { wardId, month: toDate(`${month}-01`) } }, update: {}, create: { wardId, month: toDate(`${month}-01`) } });
  let replaced = 0;
  const days = eachDay(toYmd(req.start), toYmd(req.end)).filter((x) => x.startsWith(month));
  // a reported sickness stays: leave does not overwrite sick days (the days count as sick, not as leave)
  const sick = new Set((await tx.shift.findMany({ where: { planId: plan.id, userId: req.userId, date: { in: days.map(toDate) }, shiftType: { kind: "SICK" } }, select: { date: true } })).map((r) => toYmd(r.date)));
  if (sick.size) {
    const reports = await tx.sickReport.findMany({ where: { userId: req.userId, start: { lte: req.end }, end: { gte: req.start } } });
    for (const r of reports) {
      const replaced = (r.replaced as unknown as { date: string; draft: string | null }[]).map((x) => (sick.has(x.date) ? { ...x, draft: req.shiftTypeId } : x));
      await tx.sickReport.update({ where: { id: r.id }, data: { replaced: replaced as unknown as Prisma.InputJsonValue } });
    }
  }
  for (const d of days.filter((x) => !sick.has(x))) {
    const before = await applyShift(tx, plan.id, req.userId, actorId, d, req.shiftTypeId);
    if (before && before.shiftTypeId !== req.shiftTypeId) replaced++;
  }
  return replaced;
}

/** Row lock on a leave request: decisions on the same request run one at a time and see each other's result. */
const lockLeave = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "LeaveRequest" WHERE id = ${id} FOR UPDATE`;

export async function decideLeave(id: string, actorId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, DECIDERS);
    await lockLeave(tx, id);
    const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: { user: true, shiftType: true } });
    if (req.user.wardId !== me.wardId) throw new ForbiddenError("Antrag gehört zu einer anderen Station");
    if (req.status !== "PENDING") throw new LeaveError("Der Antrag wurde bereits bearbeitet oder zurückgezogen.");
    if (decision === "REJECTED" && !comment?.trim()) throw new LeaveError("Eine Ablehnung braucht eine Begründung.");

    const pendingMonths: string[] = [];
    let replaced = 0;
    if (decision === "APPROVED") {
      for (const month of monthsBetween(toYmd(req.start), toYmd(req.end))) {
        const plan = await tx.plan.findUnique({ where: { wardId_month: { wardId: req.user.wardId, month: toDate(`${month}-01`) } } });
        // plans under review/approved/published are not touched silently; the planner applies those months explicitly
        if (!plan || plan.status === "DRAFT" || plan.status === "CHANGES_REQUESTED") replaced += await applyMonth(tx, req, month, req.user.wardId, actorId);
        else pendingMonths.push(month);
      }
    }
    await tx.leaveRequest.update({ where: { id }, data: { status: decision, decidedById: actorId, decidedAt: new Date(), decisionComment: comment?.trim() || null, pendingMonths } });
    await tx.notification.create({
      data: {
        userId: req.userId, type: "LEAVE_DECIDED",
        title: decision === "APPROVED" ? "Antrag genehmigt" : "Antrag abgelehnt",
        body: `${req.shiftType.name} ${dmy(toYmd(req.start))}–${dmy(toYmd(req.end))}${decision === "REJECTED" ? `: ${comment!.trim()}` : ""}`,
      },
    });
    return { pendingMonths, replaced };
  });
}

/** Planner applies the still-open months of an approved request (plan must not be in review). */
export async function applyPendingLeave(id: string, month: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["PLANNER", "ADMIN"]);
    await lockLeave(tx, id);
    const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: { user: true } });
    if (req.user.wardId !== me.wardId) throw new ForbiddenError("Antrag gehört zu einer anderen Station");
    if (req.status !== "APPROVED" || !req.pendingMonths.includes(month)) throw new LeaveError("Für diesen Monat ist nichts zu übernehmen.");
    const plan = await tx.plan.findUnique({ where: { wardId_month: { wardId: me.wardId, month: toDate(`${month}-01`) } } });
    if (plan) {
      const { state } = await loadState(tx, plan.id);
      if (state.status === "IN_REVIEW") throw new LeaveError("Der Plan ist gerade in Prüfung. Bitte nach der Entscheidung übernehmen.");
    }
    const replaced = await applyMonth(tx, req, month, me.wardId, actorId);
    await tx.leaveRequest.update({ where: { id }, data: { pendingMonths: req.pendingMonths.filter((m) => m !== month) } });
    return { replaced };
  });
}

/** Extra context for the decider: who else is away in that period, and how many planned shifts would be replaced. */
export async function leaveContext(id: string) {
  const req = await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: { user: true } });
  const range = { start: toYmd(req.start), end: toYmd(req.end) };
  const others = await prisma.leaveRequest.findMany({
    where: { id: { not: id }, status: { in: ["PENDING", "APPROVED"] }, user: { wardId: req.user.wardId }, start: { lte: req.end }, end: { gte: req.start } },
    include: { user: { select: { name: true } }, shiftType: { select: { name: true } } },
  });
  const clashing = await prisma.shift.count({
    where: { userId: req.userId, date: { gte: req.start, lte: req.end }, shiftType: { kind: "WORK" } },
  });
  return {
    clashingShifts: clashing,
    others: others.map((o) => ({ name: o.user.name, status: o.status, type: o.shiftType.name, start: toYmd(o.start), end: toYmd(o.end) })),
    range,
  };
}

