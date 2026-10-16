import type { Role } from "@prisma/client";
import { eachDay, monthsBetween, rangesOverlap, validateLeaveRange } from "@dienstplan/core";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { actor, applyShift, ForbiddenError, loadState, type Tx } from "./service";

const DECIDERS: Role[] = ["PLANNER", "ADMIN", "PDL"];
const REQUESTABLE = ["VACATION", "SPECIAL_LEAVE"] as const;
const todayYmd = () => new Date().toISOString().slice(0, 10);

export class LeaveError extends Error {}

const dmy = (d: string) => d.split("-").reverse().join(".");

async function notifyDeciders(tx: Tx, wardId: string, title: string, body: string) {
  const users = await tx.user.findMany({ where: { wardId, active: true, role: { in: ["PLANNER", "PDL"] } } });
  await tx.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: "LEAVE_REQUESTED", title, body })) });
}

export async function createLeave(userId: string, input: { shiftTypeId: string; start: string; end: string; note?: string }, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const type = await tx.shiftType.findFirst({ where: { id: input.shiftTypeId, wardId: user.wardId } });
    if (!type || !(REQUESTABLE as readonly string[]).includes(type.kind)) throw new LeaveError("Diese Abwesenheitsart kann nicht beantragt werden.");
    const err = validateLeaveRange(input.start, input.end, today);
    if (err) throw new LeaveError(err);
    const note = input.note?.trim().slice(0, 500) || null;
    if (type.kind === "SPECIAL_LEAVE" && !note) throw new LeaveError("Bitte gib für Sonderurlaub einen Grund an.");

    const mine = await tx.leaveRequest.findMany({ where: { userId, status: { in: ["PENDING", "APPROVED"] }, end: { gte: toDate(input.start) }, start: { lte: toDate(input.end) } } });
    if (mine.some((r) => rangesOverlap({ start: toYmd(r.start), end: toYmd(r.end) }, input))) throw new LeaveError("Der Zeitraum überschneidet sich mit einem bestehenden Antrag.");

    const req = await tx.leaveRequest.create({ data: { userId, shiftTypeId: type.id, start: toDate(input.start), end: toDate(input.end), note } });
    await notifyDeciders(tx, user.wardId, "Neuer Abwesenheitsantrag", `${user.name}: ${type.name} ${dmy(input.start)}–${dmy(input.end)}`);
    return req;
  });
}

export async function cancelLeave(id: string, userId: string) {
  const { count } = await prisma.leaveRequest.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!count) throw new LeaveError("Nur offene eigene Anträge können zurückgezogen werden.");
}

/** Writes the leave into the roster of one month. Returns how many existing cells with a different entry were replaced. */
async function applyMonth(tx: Tx, req: { id: string; userId: string; shiftTypeId: string; start: Date; end: Date }, month: string, wardId: string, actorId: string) {
  const plan = await tx.plan.upsert({ where: { wardId_month: { wardId, month: toDate(`${month}-01`) } }, update: {}, create: { wardId, month: toDate(`${month}-01`) } });
  let replaced = 0;
  for (const d of eachDay(toYmd(req.start), toYmd(req.end)).filter((x) => x.startsWith(month))) {
    const before = await applyShift(tx, plan.id, req.userId, actorId, d, req.shiftTypeId);
    if (before && before.shiftTypeId !== req.shiftTypeId) replaced++;
  }
  return replaced;
}

export async function decideLeave(id: string, actorId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, DECIDERS);
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

