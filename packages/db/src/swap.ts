import { newViolations, swapChanges, SwapConflict, type Assignment, type CellChange, type SwapSpec, type Violation, localToday } from "@dienstplan/core";
import type { Prisma, SwapStatus } from "@prisma/client";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { actor, ForbiddenError, type Tx } from "./service";
import { writeRosterCells } from "./rosterCells";
import type { SnapshotShift } from "./service";

export class SwapError extends Error {}

const todayYmd = () => localToday(); // the ward's local date, not UTC
const dmy = (d: string) => d.split("-").reverse().join(".");
const ACTIVE: SwapStatus[] = ["OPEN", "PENDING_PARTNER", "PENDING_PLANNER"];

const ruleText = (v: Violation) =>
  v.rule === "REST_TIME" ? `Ruhezeit nur ${Math.max(0, v.restHours)} h vor dem ${dmy(v.date)}` :
  v.rule === "MAX_CONSECUTIVE" ? `${v.days}. Arbeitstag in Folge am ${dmy(v.date)}` : "Mindestbesetzung";

/** Published roster of a ward as assignments (what staff see), for the months around the given dates. */
async function publishedRoster(tx: Tx, wardId: string, dates: string[]): Promise<{ roster: Assignment[]; types: { id: string; startMin: number; endMin: number; kind: string }[] }> {
  const months = new Set<string>();
  for (const d of dates) for (const k of [-1, 0, 1]) months.add(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + k, 1)).toISOString().slice(0, 10));
  const [plans, types] = await Promise.all([
    tx.plan.findMany({ where: { wardId, month: { in: [...months].map(toDate) } } }),
    tx.shiftType.findMany({ where: { wardId } }),
  ]);
  const roster = plans.flatMap((p) => ((p.publishedSnapshot ?? []) as unknown as SnapshotShift[]).map((s) => ({ userId: s.userId, date: s.date, shiftTypeId: s.shiftTypeId })));
  return { roster, types };
}

interface Checked { changes: CellChange[]; problems: string[] }

/** Applies the swap logic to the current published roster. Returns the cell changes and any rule problems it would cause. */
async function check(tx: Tx, wardId: string, spec: SwapSpec): Promise<Checked> {
  const { roster, types } = await publishedRoster(tx, wardId, [spec.date, ...(spec.partnerDate ? [spec.partnerDate] : [])]);
  let changes: CellChange[];
  try { changes = swapChanges(spec, roster); } catch (e) { if (e instanceof SwapConflict) throw new SwapError(e.message); throw e; }
  const names = new Map((await tx.user.findMany({ where: { id: { in: [spec.requesterId, spec.partnerId] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const problems = newViolations(roster, changes, types.map((t) => ({ id: t.id, startMin: t.startMin, endMin: t.endMin, kind: t.kind as never }))).map(
    (v) => `${"userId" in v ? names.get(v.userId) : ""}: ${ruleText(v)}`,
  );
  return { changes, problems };
}

const specOf = (r: { requesterId: string; partnerId: string | null; date: Date; shiftTypeId: string; partnerDate: Date | null; partnerShiftTypeId: string | null }, partnerId = r.partnerId): SwapSpec => ({
  requesterId: r.requesterId, partnerId: partnerId ?? "", date: toYmd(r.date), shiftTypeId: r.shiftTypeId,
  partnerDate: r.partnerDate ? toYmd(r.partnerDate) : null, partnerShiftTypeId: r.partnerShiftTypeId,
});

async function isEmployeeOfWard(tx: Tx, userId: string, wardId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  return !!u && u.active && u.wardId === wardId && u.role === "EMPLOYEE";
}

async function notify(tx: Tx, rows: { userId: string; type: string; title: string; body: string; shortNotice?: boolean }[]) {
  if (rows.length) await tx.notification.createMany({ data: rows });
}

/** Upcoming WORK shifts from the published roster, for choosing what to offer or ask for. */
export async function upcomingShifts(userId: string, days = 60, today = todayYmd()) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const [plans, types] = await Promise.all([
    prisma.plan.findMany({ where: { wardId: u.wardId, month: { gte: toDate(`${today.slice(0, 7)}-01`), lte: toDate(end) } } }),
    prisma.shiftType.findMany({ where: { wardId: u.wardId, kind: "WORK" } }),
  ]);
  const work = new Map(types.map((t) => [t.id, t]));
  return plans
    .flatMap((p) => ((p.publishedSnapshot ?? []) as unknown as SnapshotShift[]))
    .filter((s) => s.userId === userId && s.date >= today && s.date <= end && work.has(s.shiftTypeId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date, shiftTypeId: s.shiftTypeId, type: work.get(s.shiftTypeId)! }));
}

export async function createSwap(requesterId: string, input: { date: string; partnerId?: string | null; partnerDate?: string | null; note?: string }, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const me = await tx.user.findUniqueOrThrow({ where: { id: requesterId } });
    if (me.role !== "EMPLOYEE") throw new SwapError("Nur Mitarbeitende können Dienste tauschen.");
    if (input.date < today) throw new SwapError("Vergangene Dienste können nicht getauscht werden.");
    const partnerId = input.partnerId || null;
    const partnerDate = input.partnerDate || null;
    if (partnerDate && !partnerId) throw new SwapError("Für einen Tausch gegen einen Dienst muss eine Kollegin/ein Kollege gewählt werden.");
    if (partnerDate && partnerDate < today) throw new SwapError("Vergangene Dienste können nicht getauscht werden.");
    if (partnerId && !(await isEmployeeOfWard(tx, partnerId, me.wardId))) throw new SwapError("Diese Kollegin/dieser Kollege ist nicht verfügbar.");

    const { roster } = await publishedRoster(tx, me.wardId, [input.date]);
    const mine = roster.find((a) => a.userId === requesterId && a.date === input.date);
    const type = mine && (await tx.shiftType.findFirst({ where: { id: mine.shiftTypeId, wardId: me.wardId } }));
    if (!mine || !type || type.kind !== "WORK") throw new SwapError("Für diesen Tag ist kein tauschbarer Dienst veröffentlicht.");
    let partnerShiftTypeId: string | null = null;
    if (partnerDate) {
      const theirs = (await publishedRoster(tx, me.wardId, [partnerDate])).roster.find((a) => a.userId === partnerId && a.date === partnerDate);
      const t2 = theirs && (await tx.shiftType.findFirst({ where: { id: theirs.shiftTypeId, wardId: me.wardId } }));
      if (!theirs || !t2 || t2.kind !== "WORK") throw new SwapError("Die Kollegin/der Kollege hat an diesem Tag keinen tauschbaren Dienst.");
      partnerShiftTypeId = theirs.shiftTypeId;
    }
    const dup = await tx.swapRequest.findFirst({ where: { requesterId, date: toDate(input.date), status: { in: ACTIVE } } });
    if (dup) throw new SwapError("Für diesen Dienst gibt es bereits eine offene Anfrage.");

    if (partnerId) {
      const { problems } = await check(tx, me.wardId, { requesterId, partnerId, date: input.date, shiftTypeId: mine.shiftTypeId, partnerDate, partnerShiftTypeId });
      if (problems.length) throw new SwapError(`Der Tausch würde Regeln verletzen: ${problems.join("; ")}`);
    }
    const req = await tx.swapRequest.create({
      data: {
        wardId: me.wardId, requesterId, partnerId, date: toDate(input.date), shiftTypeId: mine.shiftTypeId,
        partnerDate: partnerDate ? toDate(partnerDate) : null, partnerShiftTypeId, note: input.note?.trim().slice(0, 300) || null,
        status: partnerId ? "PENDING_PARTNER" : "OPEN",
      },
    });
    if (partnerId) {
      await notify(tx, [{ userId: partnerId, type: "SWAP_PROPOSED", title: "Tauschanfrage", body: `${me.name} möchte ${partnerDate ? `den ${type.name} am ${dmy(input.date)} gegen deinen Dienst am ${dmy(partnerDate)} tauschen` : `den ${type.name} am ${dmy(input.date)} an dich abgeben`}.`, shortNotice: input.date <= new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) }]);
    }
    return req;
  });
}

/** Colleague accepts (named partner) or takes (open offer). Moves the request to the planner. */
export async function acceptSwap(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.swapRequest.findUniqueOrThrow({ where: { id }, include: { requester: true, shiftType: true } });
    const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (me.wardId !== req.wardId || me.role !== "EMPLOYEE" || userId === req.requesterId) throw new ForbiddenError("Nicht möglich");
    if (req.status === "PENDING_PARTNER" ? req.partnerId !== userId : req.status !== "OPEN") throw new SwapError("Diese Anfrage ist nicht mehr offen.");
    if (toYmd(req.date) < todayYmd()) throw new SwapError("Der Dienst liegt in der Vergangenheit.");
    const { problems } = await check(tx, req.wardId, specOf(req, userId));
    if (problems.length) throw new SwapError(`Das würde Regeln verletzen: ${problems.join("; ")}`);
    await tx.swapRequest.update({ where: { id }, data: { partnerId: userId, status: "PENDING_PLANNER" } });
    const planners = await tx.user.findMany({ where: { wardId: req.wardId, active: true, role: "PLANNER" } });
    const what = `${req.shiftType.name} ${dmy(toYmd(req.date))}`;
    await notify(tx, [
      { userId: req.requesterId, type: "SWAP_ACCEPTED", title: "Tausch angenommen", body: `${me.name} hat zugestimmt (${what}). Jetzt entscheidet die Planung.` },
      ...planners.map((p) => ({ userId: p.id, type: "SWAP_REVIEW", title: "Tausch zur Freigabe", body: `${req.requester.name} ↔ ${me.name}: ${what}` })),
    ]);
  });
}

export async function declineSwap(id: string, userId: string) {
  const { count } = await prisma.swapRequest.updateMany({ where: { id, partnerId: userId, status: "PENDING_PARTNER" }, data: { status: "DECLINED" } });
  if (!count) throw new SwapError("Nur eine an dich gerichtete offene Anfrage kann abgelehnt werden.");
  const req = await prisma.swapRequest.findUniqueOrThrow({ where: { id }, include: { partner: true } });
  await prisma.notification.create({ data: { userId: req.requesterId, type: "SWAP_DECLINED", title: "Tausch abgelehnt", body: `${req.partner?.name} kann den Dienst am ${dmy(toYmd(req.date))} nicht übernehmen.` } });
}

export async function cancelSwap(id: string, userId: string) {
  const { count } = await prisma.swapRequest.updateMany({ where: { id, requesterId: userId, status: { in: ACTIVE } }, data: { status: "CANCELLED" } });
  if (!count) throw new SwapError("Nur eigene offene Anfragen können zurückgezogen werden.");
}

/** Writes final cell states into Shift rows and the published snapshot; refuses if unpublished edits touch those cells. */
async function writeCells(tx: Tx, wardId: string, changes: CellChange[], actorId: string, swapId: string) {
  for (const month of new Set(changes.map((c) => c.date.slice(0, 7)))) {
    const plan = await tx.plan.findUnique({ where: { wardId_month: { wardId, month: toDate(`${month}-01`) } } });
    if (!plan || plan.publishedSnapshot == null) throw new SwapError("Für diesen Monat gibt es keinen veröffentlichten Plan.");
  }
  await writeRosterCells(tx, wardId, changes.map((c) => ({
    userId: c.userId, date: c.date,
    value: (now) => {
      if (now.draft !== now.published) throw new SwapError("Der Plan enthält für diesen Tag noch ungeprüfte Änderungen.");
      return { draft: c.shiftTypeId, published: c.shiftTypeId };
    },
  })), { actorId, action: "SWAP_APPLIED", detail: { swapId, cells: changes.map((c) => ({ userId: c.userId, date: c.date, shiftTypeId: c.shiftTypeId })) } });
}

export async function decideSwap(id: string, actorId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["PLANNER", "ADMIN"]);
    const req = await tx.swapRequest.findUniqueOrThrow({ where: { id }, include: { requester: true, partner: true, shiftType: true } });
    if (req.wardId !== me.wardId) throw new ForbiddenError("Andere Station");
    if (req.status !== "PENDING_PLANNER" || !req.partnerId) throw new SwapError("Die Anfrage wartet nicht auf eine Entscheidung.");
    if (decision === "REJECTED" && !comment?.trim()) throw new SwapError("Eine Ablehnung braucht eine Begründung.");
    const what = `${req.shiftType.name} ${dmy(toYmd(req.date))}`;
    const both = [req.requesterId, req.partnerId];

    if (decision === "APPROVED") {
      if (toYmd(req.date) < todayYmd()) throw new SwapError("Der Dienst liegt in der Vergangenheit.");
      const { changes, problems } = await check(tx, req.wardId, specOf(req));
      if (problems.length) throw new SwapError(`Der Tausch würde Regeln verletzen: ${problems.join("; ")}`);
      await writeCells(tx, req.wardId, changes, actorId, id);
      const short = toYmd(req.date) <= new Date(Date.now() + 72 * 3_600_000).toISOString().slice(0, 10);
      await notify(tx, both.map((u) => ({ userId: u, type: "SWAP_APPLIED", title: "Tausch durchgeführt", body: `${what} – dein Dienstplan wurde angepasst.`, shortNotice: short })));
    } else {
      await notify(tx, both.map((u) => ({ userId: u, type: "SWAP_REJECTED", title: "Tausch nicht genehmigt", body: `${what}: ${comment!.trim()}` })));
    }
    await tx.swapRequest.update({ where: { id }, data: { status: decision === "APPROVED" ? "APPLIED" : "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionComment: comment?.trim() || null } });
  });
}

/** Marks offers whose date has passed as expired, then returns everything a person needs for the swap page. */
export async function swapBoard(userId: string, today = todayYmd()) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.swapRequest.updateMany({ where: { wardId: me.wardId, status: { in: ACTIVE }, date: { lt: toDate(today) } }, data: { status: "EXPIRED" } });
  const include = { requester: { select: { id: true, name: true } }, partner: { select: { id: true, name: true } }, shiftType: true, partnerShiftType: true } as const;
  const [mine, forMe, open] = await Promise.all([
    prisma.swapRequest.findMany({ where: { requesterId: userId }, orderBy: { createdAt: "desc" }, take: 30, include }),
    prisma.swapRequest.findMany({ where: { partnerId: userId, status: "PENDING_PARTNER" }, orderBy: { date: "asc" }, include }),
    prisma.swapRequest.findMany({ where: { wardId: me.wardId, status: "OPEN", requesterId: { not: userId } }, orderBy: { date: "asc" }, include }),
  ]);
  return { mine, forMe, open };
}

/** For a planner: swaps waiting for a decision, each with its current rule check. */
export async function swapsForPlanner(plannerId: string) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: plannerId } });
  const rows = await prisma.swapRequest.findMany({
    where: { wardId: me.wardId, status: "PENDING_PLANNER" }, orderBy: { date: "asc" },
    include: { requester: { select: { name: true } }, partner: { select: { name: true } }, shiftType: true, partnerShiftType: true },
  });
  return Promise.all(rows.map(async (r) => {
    let problems: string[] = [];
    try { problems = (await prisma.$transaction((tx) => check(tx, r.wardId, specOf(r)))).problems; } catch (e) { if (e instanceof SwapError) problems = [e.message]; else throw e; }
    return { ...r, problems };
  }));
}

/** Preview for the creation form: would this proposal break any rule? */
export async function previewSwap(requesterId: string, input: { date: string; partnerId: string; partnerDate?: string | null }) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: requesterId } });
  return prisma.$transaction(async (tx) => {
    const { roster } = await publishedRoster(tx, me.wardId, [input.date]);
    const mine = roster.find((a) => a.userId === requesterId && a.date === input.date);
    const theirs = input.partnerDate ? (await publishedRoster(tx, me.wardId, [input.partnerDate])).roster.find((a) => a.userId === input.partnerId && a.date === input.partnerDate) : null;
    if (!mine) return ["Für diesen Tag ist kein Dienst veröffentlicht."];
    try {
      return (await check(tx, me.wardId, { requesterId, partnerId: input.partnerId, date: input.date, shiftTypeId: mine.shiftTypeId, partnerDate: input.partnerDate || null, partnerShiftTypeId: theirs?.shiftTypeId ?? null })).problems;
    } catch (e) { if (e instanceof SwapError) return [e.message]; throw e; }
  });
}

/** Can this person take the open offer without breaking a rule? (shown on the board) */
export async function canTake(id: string, userId: string): Promise<string[]> {
  const req = await prisma.swapRequest.findUniqueOrThrow({ where: { id } });
  try { return (await prisma.$transaction((tx) => check(tx, req.wardId, specOf(req, userId)))).problems; } catch (e) { if (e instanceof SwapError) return [e.message]; throw e; }
}

