import { computeBalance, countDays, eachDay, type Balance, type CountMode } from "@dienstplan/core";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { actor, type Tx } from "./service";

export class BalanceError extends Error {}

const todayYmd = () => new Date().toISOString().slice(0, 10);
const yearRange = (year: number) => ({ gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) });

export interface BalanceResult extends Balance { configured: true; mode: CountMode; carryOverExpires: string | null }
export type MaybeBalance = BalanceResult | { configured: false; year: number; mode: CountMode };

/** Leave balance of one person for one year, or `configured: false` if no entitlement was entered for that year. */
export async function getBalance(userId: string, year: number, today = todayYmd(), client: Tx | typeof prisma = prisma): Promise<MaybeBalance> {
  const user = await client.user.findUniqueOrThrow({ where: { id: userId }, include: { ward: true } });
  const mode = user.ward.leaveCountMode as CountMode;
  const ent = await client.leaveEntitlement.findUnique({ where: { userId_year: { userId, year } } });
  if (!ent) return { configured: false, year, mode };

  const [rows, open, approved] = await Promise.all([
    client.shift.findMany({ where: { userId, date: yearRange(year), shiftType: { consumesLeave: true } }, select: { date: true } }),
    client.leaveRequest.findMany({ where: { userId, status: "PENDING", shiftType: { consumesLeave: true }, start: { lte: toDate(`${year}-12-31`) }, end: { gte: toDate(`${year}-01-01`) } } }),
    client.leaveRequest.findMany({ where: { userId, status: "APPROVED", pendingMonths: { isEmpty: false }, shiftType: { consumesLeave: true } } }),
  ]);
  const expand = (r: { start: Date; end: Date }, months?: string[]) =>
    eachDay(toYmd(r.start), toYmd(r.end)).filter((d) => d.startsWith(`${year}-`) && (!months || months.includes(d.slice(0, 7))));
  const b = computeBalance({
    ent: { year, entitlement: ent.entitlement, carryOver: ent.carryOver, carryOverExpires: ent.carryOverExpires ? toYmd(ent.carryOverExpires) : null, adjustment: ent.adjustment },
    today, mode,
    inRoster: rows.map((r) => toYmd(r.date)),
    requested: open.flatMap((r) => expand(r)),
    held: approved.flatMap((r) => expand(r, r.pendingMonths)),
  });
  return { ...b, configured: true, mode, carryOverExpires: ent.carryOverExpires ? toYmd(ent.carryOverExpires) : null };
}

/** Throws a German LeaveError-style message if the days of a new request exceed what is left (only for configured years). */
export async function assertEnoughLeave(tx: Tx, userId: string, start: string, end: string, today: string): Promise<string | null> {
  const years = [...new Set(eachDay(start, end).map((d) => Number(d.slice(0, 4))))];
  for (const year of years) {
    const b = await getBalance(userId, year, today, tx);
    if (!b.configured) continue;
    const days = countDays(eachDay(start, end).filter((d) => d.startsWith(`${year}-`)), b.mode);
    if (days > b.remaining) {
      return `Nicht genug Resturlaub ${year}: ${b.remaining} Tag(e) verfügbar, ${days} beantragt.`;
    }
  }
  return null;
}

const validNumber = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max && Math.round(n * 2) === n * 2;

export interface EntitlementInput { entitlement: number; carryOver?: number; carryOverExpires?: string | null; adjustment?: number; note?: string }

function validate(input: EntitlementInput, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BalanceError("Ungültiges Jahr.");
  if (!validNumber(input.entitlement, 0, 366)) throw new BalanceError("Der Jahresanspruch muss zwischen 0 und 366 Tagen liegen (halbe Tage erlaubt).");
  if (!validNumber(input.carryOver ?? 0, 0, 366)) throw new BalanceError("Der Übertrag muss zwischen 0 und 366 Tagen liegen (halbe Tage erlaubt).");
  if (!validNumber(input.adjustment ?? 0, -366, 366)) throw new BalanceError("Die Korrektur muss zwischen -366 und 366 Tagen liegen (halbe Tage erlaubt).");
  if (input.carryOverExpires && !/^\d{4}-\d{2}-\d{2}$/.test(input.carryOverExpires)) throw new BalanceError("Ungültiges Verfallsdatum.");
}

export async function setEntitlement(actorId: string, userId: string, year: number, input: EntitlementInput) {
  validate(input, year);
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["PLANNER", "ADMIN"]);
    const target = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (target.wardId !== me.wardId || target.role !== "EMPLOYEE") throw new BalanceError("Für diese Person kann kein Urlaubsanspruch geführt werden.");
    const data = { entitlement: input.entitlement, carryOver: input.carryOver ?? 0, carryOverExpires: input.carryOverExpires ? toDate(input.carryOverExpires) : null, adjustment: input.adjustment ?? 0, note: input.note?.slice(0, 200) || null };
    return tx.leaveEntitlement.upsert({ where: { userId_year: { userId, year } }, update: data, create: { userId, year, ...data } });
  });
}

/** Everyone in the ward without an entitlement for `year` gets the default (no overwrite of existing entries). */
export async function setDefaultEntitlements(actorId: string, year: number, days: number) {
  validate({ entitlement: days }, year);
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["PLANNER", "ADMIN"]);
    const staff = await tx.user.findMany({ where: { wardId: me.wardId, role: "EMPLOYEE", active: true } });
    const existing = new Set((await tx.leaveEntitlement.findMany({ where: { year, userId: { in: staff.map((s) => s.id) } } })).map((e) => e.userId));
    const fresh = staff.filter((s) => !existing.has(s.id));
    await tx.leaveEntitlement.createMany({ data: fresh.map((s) => ({ userId: s.id, year, entitlement: days })) });
    return { created: fresh.length };
  });
}

/**
 * Year-end rollover: creates `year + 1` for everyone who has `year`, with the same entitlement and the remaining days as carry-over
 * (expiring on `expires`, usually 31 March). Existing entries of the new year are left alone.
 */
export async function rolloverYear(actorId: string, year: number, expires: string | null = `${year + 1}-03-31`, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["PLANNER", "ADMIN"]);
    const ents = await tx.leaveEntitlement.findMany({ where: { year, user: { wardId: me.wardId, active: true, role: "EMPLOYEE" } } });
    const done = new Set((await tx.leaveEntitlement.findMany({ where: { year: year + 1, userId: { in: ents.map((e) => e.userId) } } })).map((e) => e.userId));
    let created = 0;
    for (const e of ents) {
      if (done.has(e.userId)) continue;
      const b = await getBalance(e.userId, year, today, tx);
      const carry = b.configured ? Math.max(0, b.remaining) : 0;
      await tx.leaveEntitlement.create({ data: { userId: e.userId, year: year + 1, entitlement: e.entitlement, carryOver: carry, carryOverExpires: carry > 0 && expires ? toDate(expires) : null } });
      created++;
    }
    return { created };
  });
}

/** Everyone's balance for the planner overview. */
export async function wardBalances(actorId: string, year: number, today = todayYmd()) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  const staff = await prisma.user.findMany({ where: { wardId: me.wardId, role: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, include: { entitlements: { where: { year } } } });
  return Promise.all(staff.map(async (s) => ({ user: { id: s.id, name: s.name }, entitlement: s.entitlements[0] ?? null, balance: await getBalance(s.id, year, today) })));
}
