import { isYmd, localToday } from "@dienstplan/core";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { actor, ForbiddenError, type Tx } from "./service";

export class WishError extends Error {}

const MAX_SHIFT_WISHES = 10; // per month
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const todayYmd = () => localToday();
/** [first day, first day of the next month) — never `${month}-31`, which rolls over into the next month for short months. */
const monthRange = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { gte: toDate(`${m}-01`), lt: new Date(Date.UTC(y, mo, 1)) };
};

/** Wishes are collected for future months whose plan has never been published and is not being reviewed. Null = open. */
async function windowClosed(client: Tx | typeof prisma, wardId: string, month: string, today: string): Promise<string | null> {
  if (month <= today.slice(0, 7)) return `Für ${monthName(month)} können keine Wünsche mehr eingetragen werden.`;
  const plan = await client.plan.findUnique({ where: { wardId_month: { wardId, month: toDate(`${month}-01`) } }, select: { status: true, publishedSnapshot: true } });
  if (plan?.publishedSnapshot != null) return `Der Plan für ${monthName(month)} ist schon veröffentlicht. Bitte sprich Änderungen mit der Planung ab.`;
  // closes with the first submission for approval and stays closed (also while the plan is sent back for changes)
  if (plan && plan.status !== "DRAFT") return `Der Plan für ${monthName(month)} ist schon in der Genehmigung.`;
  return null;
}

async function employee(tx: Tx, userId: string) {
  const me = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { ward: true } });
  if (me.role !== "EMPLOYEE" || !me.active) throw new ForbiddenError("Wünsche tragen nur Mitarbeitende ein.");
  return me;
}

/** Sets (or replaces) the wish for one day. */
export async function setWish(userId: string, input: { date: string; kind: "FREE" | "SHIFT"; shiftTypeId?: string | null; note?: string }, today = todayYmd()) {
  if (!isYmd(input.date)) throw new WishError("Bitte ein gültiges Datum angeben.");
  if (input.kind !== "FREE" && input.kind !== "SHIFT") throw new WishError("Unbekannte Art von Wunsch.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`wish:${userId}`}))) AS l`; // the monthly limit holds under double taps
    const me = await employee(tx, userId);
    const month = input.date.slice(0, 7);
    const closed = await windowClosed(tx, me.wardId, month, today);
    if (closed) throw new WishError(closed);
    let shiftTypeId: string | null = null;
    if (input.kind === "SHIFT") {
      const t = await tx.shiftType.findFirst({ where: { id: input.shiftTypeId ?? "", wardId: me.wardId, kind: "WORK" } });
      if (!t) throw new WishError("Bitte einen Dienst auswählen.");
      shiftTypeId = t.id;
    }
    const others = await tx.shiftWish.count({ where: { userId, kind: input.kind, date: monthRange(month), NOT: { date: toDate(input.date) } } });
    const limit = input.kind === "FREE" ? me.ward.freeWishesPerMonth : MAX_SHIFT_WISHES;
    if (others >= limit) throw new WishError(input.kind === "FREE" ? `Pro Monat sind höchstens ${limit} Wunschfrei-Tage möglich.` : `Pro Monat sind höchstens ${limit} Dienstwünsche möglich.`);
    const data = { kind: input.kind, shiftTypeId, note: input.note?.trim().slice(0, 200) || null };
    return tx.shiftWish.upsert({ where: { userId_date: { userId, date: toDate(input.date) } }, update: data, create: { ...data, userId, wardId: me.wardId, date: toDate(input.date) } });
  });
}

export async function deleteWish(userId: string, id: string, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const w = await tx.shiftWish.findUnique({ where: { id } });
    if (!w || w.userId !== userId) throw new WishError("Wunsch nicht gefunden.");
    const closed = await windowClosed(tx, w.wardId, toYmd(w.date).slice(0, 7), today);
    if (closed) throw new WishError(closed);
    await tx.shiftWish.delete({ where: { id } });
  });
}

/** The employee's own wishes for a month, whether the month is still open for wishes, and how many Wunschfrei days are left. */
export async function myWishes(userId: string, month: string, today = todayYmd()) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { ward: true } });
  const wishes = await prisma.shiftWish.findMany({ where: { userId, date: monthRange(month) }, orderBy: { date: "asc" }, include: { shiftType: true } });
  const free = wishes.filter((w) => w.kind === "FREE").length;
  return {
    month, closed: await windowClosed(prisma, me.wardId, month, today),
    freeLimit: me.ward.freeWishesPerMonth, freeLeft: Math.max(0, me.ward.freeWishesPerMonth - free),
    wishes: wishes.map((w) => ({ id: w.id, date: toYmd(w.date), kind: w.kind, shiftTypeId: w.shiftTypeId, shiftType: w.shiftType ? { code: w.shiftType.code, name: w.shiftType.name } : null, note: w.note })),
  };
}

/** Planner/admin view of a month: everyone's wishes and standing preferences. Not for colleagues, the PDL or the Betriebsrat. */
export async function wardWishes(actorId: string, month: string) {
  const me = await actor(prisma, actorId, ["PLANNER", "ADMIN"]);
  const [wishes, prefs] = await Promise.all([
    prisma.shiftWish.findMany({ where: { wardId: me.wardId, date: monthRange(month), user: { active: true, role: "EMPLOYEE" }, NOT: { kind: "SHIFT", shiftTypeId: null } }, orderBy: { date: "asc" } }),
    prisma.shiftPreference.findMany({ where: { user: { wardId: me.wardId, active: true, role: "EMPLOYEE" } } }),
  ]);
  return {
    wishes: wishes.map((w) => ({ id: w.id, userId: w.userId, date: toYmd(w.date), kind: w.kind, shiftTypeId: w.shiftTypeId, note: w.note })),
    preferences: prefs.map((p) => ({ userId: p.userId, prefer: p.prefer, avoid: p.avoid, note: p.note })),
  };
}

export async function getPreference(userId: string) {
  const p = await prisma.shiftPreference.findUnique({ where: { userId } });
  return { prefer: p?.prefer ?? [], avoid: p?.avoid ?? [], note: p?.note ?? null };
}

/** Standing preferences: preferred and avoided work shifts and a short note. Hints for the planner, not rules. */
export async function setPreference(userId: string, input: { prefer: string[]; avoid: string[]; note?: string }) {
  return prisma.$transaction(async (tx) => {
    const me = await employee(tx, userId);
    const work = new Set((await tx.shiftType.findMany({ where: { wardId: me.wardId, kind: "WORK" }, select: { id: true } })).map((t) => t.id));
    const prefer = [...new Set(input.prefer)].filter((id) => work.has(id));
    const avoid = [...new Set(input.avoid)].filter((id) => work.has(id));
    if (prefer.some((id) => avoid.includes(id))) throw new WishError("Ein Dienst kann nicht zugleich bevorzugt und vermieden werden.");
    const data = { prefer, avoid, note: input.note?.trim().slice(0, 300) || null };
    await tx.shiftPreference.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  });
}
