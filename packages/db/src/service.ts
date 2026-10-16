import type { Prisma, Role } from "@prisma/client";
import {
  edit as coreEdit,
  publish as corePublish,
  review as coreReview,
  submit as coreSubmit,
  type Decision,
  type PlanState,
  type Reviewer,
  addDaysYmd,
  localToday,
} from "@dienstplan/core";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";

export type Tx = Prisma.TransactionClient;

export class ForbiddenError extends Error {}

export const PLAN_ROLES: Role[] = ["PLANNER", "ADMIN"];
export const SHORT_NOTICE_HOURS = 72;

/** Row lock on the plan: every change to a plan's status, rows or published copy goes through it, one at a time. */
export async function lockPlan(tx: Tx, planId: string) {
  await tx.$queryRaw`SELECT id FROM "Plan" WHERE id = ${planId} FOR UPDATE`;
}

export async function loadState(tx: Tx, planId: string): Promise<{ state: PlanState; wardId: string }> {
  await lockPlan(tx, planId);
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId }, include: { approvals: true } });
  const decisions: Record<Reviewer, Decision> = { PDL: "PENDING", BETRIEBSRAT: "PENDING" };
  for (const a of plan.approvals) {
    if (a.version === plan.version && (a.role === "PDL" || a.role === "BETRIEBSRAT")) decisions[a.role] = a.decision;
  }
  return { state: { status: plan.status, version: plan.version, decisions }, wardId: plan.wardId };
}

async function audit(tx: Tx, planId: string, actorId: string | null, action: string, detail?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { planId, actorId, action, detail } });
}

export async function actor(tx: Tx, userId: string, roles: Role[]) {
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (!roles.includes(u.role)) throw new ForbiddenError(`Role ${u.role} may not do this`);
  return u;
}

/** The actor must belong to the plan's ward. */
async function sameWard(tx: Tx, planId: string, u: { wardId: string }) {
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId }, select: { wardId: true, month: true } });
  if (plan.wardId !== u.wardId) throw new ForbiddenError("Plan gehört zu einer anderen Station");
  return plan;
}

export async function getOrCreatePlan(wardId: string, monthYmd: string) {
  const month = toDate(`${monthYmd.slice(0, 7)}-01`);
  return prisma.plan.upsert({ where: { wardId_month: { wardId, month } }, update: {}, create: { wardId, month } });
}

/** Core of a roster edit, shared by planner edits and leave application: editing a reviewed/published plan starts a new version. */
export async function applyShift(tx: Tx, planId: string, userId: string, actorId: string, dateYmd: string, shiftTypeId: string | null) {
  const { state } = await loadState(tx, planId);
  const next = coreEdit(state);
  if (next !== state) {
    await tx.plan.update({ where: { id: planId }, data: { status: next.status, version: next.version } });
    await audit(tx, planId, actorId, "NEW_VERSION", { version: next.version });
  }
  const where = { planId_userId_date: { planId, userId, date: toDate(dateYmd) } };
  const existing = await tx.shift.findUnique({ where });
  if (!shiftTypeId) {
    if (existing) await tx.shift.delete({ where });
  } else if (existing) {
    await tx.shift.update({ where, data: { shiftTypeId, sequence: { increment: 1 } } });
  } else {
    await tx.shift.create({ data: { planId, userId, shiftTypeId, date: toDate(dateYmd) } });
  }
  await audit(tx, planId, actorId, "SET_SHIFT", { userId, date: dateYmd, shiftTypeId });
  return existing;
}

/** Assign (or clear, with shiftTypeId=null) one cell of the roster grid. */
export async function setShift(planId: string, userId: string, actorId: string, dateYmd: string, shiftTypeId: string | null) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, PLAN_ROLES);
    const plan = await sameWard(tx, planId, me);
    if (dateYmd.slice(0, 7) !== toYmd(plan.month).slice(0, 7)) throw new ForbiddenError("Der Tag liegt nicht im Monat dieses Plans");
    const [who, type] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { wardId: true } }),
      shiftTypeId ? tx.shiftType.findUnique({ where: { id: shiftTypeId }, select: { wardId: true } }) : null,
    ]);
    if (who?.wardId !== plan.wardId || (shiftTypeId && type?.wardId !== plan.wardId)) throw new ForbiddenError("Person oder Dienstart gehört zu einer anderen Station");
    await applyShift(tx, planId, userId, actorId, dateYmd, shiftTypeId);
  });
}

export async function submitPlan(planId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await sameWard(tx, planId, await actor(tx, actorId, PLAN_ROLES));
    const { state } = await loadState(tx, planId);
    const next = coreSubmit(state);
    await tx.plan.update({ where: { id: planId }, data: { status: next.status } });
    for (const role of ["PDL", "BETRIEBSRAT"] as const) {
      await tx.approval.upsert({
        where: { planId_version_role: { planId, version: next.version, role } },
        update: { decision: "PENDING", comment: null, decidedAt: null, decidedById: null },
        create: { planId, version: next.version, role },
      });
    }
    await audit(tx, planId, actorId, "SUBMITTED", { version: next.version });
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
    const reviewers = await tx.user.findMany({ where: { wardId: plan.wardId, active: true, role: { in: ["PDL", "BETRIEBSRAT"] } } });
    await tx.notification.createMany({
      data: reviewers.map((r) => ({
        userId: r.id, type: "REVIEW_REQUESTED", title: "Dienstplan zur Prüfung",
        body: `Der Dienstplan ${plan.month.toISOString().slice(0, 7)} (Version ${next.version}) wartet auf deine Entscheidung.`,
      })),
    });
  });
}

export async function reviewPlan(planId: string, actorId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  return prisma.$transaction(async (tx) => {
    const u = await actor(tx, actorId, ["PDL", "BETRIEBSRAT"]);
    await sameWard(tx, planId, u);
    const who = u.role as Reviewer;
    if (decision === "REJECTED" && !comment?.trim()) throw new Error("A rejection needs a comment");
    const { state } = await loadState(tx, planId);
    const next = coreReview(state, who, decision);
    await tx.approval.update({
      where: { planId_version_role: { planId, version: state.version, role: who } },
      data: { decision, comment: comment?.trim() || null, decidedAt: new Date(), decidedById: actorId },
    });
    await tx.plan.update({ where: { id: planId }, data: { status: next.status } });
    await audit(tx, planId, actorId, decision === "APPROVED" ? "APPROVED" : "REJECTED", { role: who, comment });
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
    const planners = await tx.user.findMany({ where: { wardId: plan.wardId, active: true, role: "PLANNER" } });
    const who2 = who === "PDL" ? "Die PDL" : "Der Betriebsrat";
    await tx.notification.createMany({
      data: planners.map((p) => ({
        userId: p.id, type: "REVIEW_DECISION",
        title: decision === "APPROVED" ? `${who2} hat genehmigt` : `${who2} hat abgelehnt`,
        body: decision === "APPROVED"
          ? (next.status === "APPROVED" ? "Beide Genehmigungen liegen vor – der Plan kann veröffentlicht werden." : "Die zweite Genehmigung steht noch aus.")
          : `Änderung angefordert: ${comment?.trim()}`,
      })),
    });
  });
}

export async function publishPlan(planId: string, actorId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await sameWard(tx, planId, await actor(tx, actorId, PLAN_ROLES));
    const { state } = await loadState(tx, planId);
    const next = corePublish(state);
    const old = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
    const prevSnap = (old.publishedSnapshot ?? []) as unknown as SnapshotShift[];
    const shifts = await tx.shift.findMany({ where: { planId }, include: { shiftType: true } });
    // calendar clients only take an update with a higher SEQUENCE: never go below what was published for that event
    const prevById = new Map(prevSnap.map((p) => [p.id, p]));
    const snapshot: SnapshotShift[] = shifts.map((s) => {
      const p = prevById.get(s.id);
      const sequence = !p ? s.sequence : p.shiftTypeId === s.shiftTypeId ? Math.max(s.sequence, p.sequence) : Math.max(s.sequence, p.sequence + 1);
      return { id: s.id, userId: s.userId, date: toYmd(s.date), shiftTypeId: s.shiftTypeId, sequence };
    });
    await tx.plan.update({
      where: { id: planId },
      data: { status: next.status, publishedAt: now, publishedVersion: state.version, publishedSnapshot: snapshot as unknown as Prisma.InputJsonValue },
    });

    // notify everyone whose shifts changed (or everyone with shifts, on first publish)
    const prevByKey = new Map(prevSnap.map((s) => [`${s.userId}|${s.date}`, s.shiftTypeId]));
    const nowByKey = new Map(snapshot.map((s) => [`${s.userId}|${s.date}`, s.shiftTypeId]));
    const affected = new Map<string, { shortNotice: boolean }>();
    const today = localToday(now), last = addDaysYmd(today, SHORT_NOTICE_HOURS / 24);
    for (const k of new Set([...prevByKey.keys(), ...nowByKey.keys()])) {
      if (prevByKey.get(k) === nowByKey.get(k)) continue;
      const [uid, date] = k.split("|") as [string, string];
      const short = date >= today && date <= last;
      const cur = affected.get(uid);
      affected.set(uid, { shortNotice: (cur?.shortNotice ?? false) || short });
    }
    const first = old.publishedSnapshot == null;
    const label = old.month.toISOString().slice(0, 7);
    await tx.notification.createMany({
      data: [...affected].map(([userId, { shortNotice }]) => ({
        userId,
        type: first ? "PLAN_PUBLISHED" : "SHIFT_CHANGED",
        shortNotice,
        title: first ? "Dienstplan veröffentlicht" : shortNotice ? "Kurzfristige Änderung" : "Dienstplan geändert",
        body: first ? `Der Dienstplan für ${label} ist online.` : `Deine Dienste im Plan ${label} haben sich geändert.`,
      })),
    });
    await audit(tx, planId, actorId, "PUBLISHED", { version: state.version, notified: affected.size });
  });
}

export interface SnapshotShift { id: string; userId: string; date: string; shiftTypeId: string; sequence: number }

export async function approvalsFor(planId: string) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  return prisma.approval.findMany({ where: { planId, version: plan.version }, include: { decidedBy: { select: { name: true } } } });
}


