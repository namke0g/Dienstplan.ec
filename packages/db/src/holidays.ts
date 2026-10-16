import { holidayMap, isState, isYmd, type CountMode, type Holiday } from "@dienstplan/core";
import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { actor, type Tx } from "./service";
import { AdminError } from "./admin";

type Db = Tx | typeof prisma;

/** Public holidays of the ward's state plus its own extra days, between two dates (inclusive): date -> name. */
export async function wardHolidays(wardId: string, from: string, to: string, db: Db = prisma): Promise<Map<string, string>> {
  const ward = await db.ward.findUniqueOrThrow({ where: { id: wardId }, include: { holidays: { where: { date: { gte: toDate(from), lte: toDate(to) } } } } });
  return holidayMap(from, to, isState(ward.state) ? ward.state : null, ward.holidays.map((h) => ({ date: toYmd(h.date), name: h.name })));
}

/**
 * The days of a year that are never deducted from leave: the ward's holidays, unless the ward counts holidays as leave days.
 * The single place that decides this, used by balances, leave checks and the decision view.
 */
export async function leaveFreeDays(wardId: string, year: number, db: Db = prisma): Promise<Set<string>> {
  const ward = await db.ward.findUniqueOrThrow({ where: { id: wardId }, select: { holidaysAreLeaveDays: true } });
  if (ward.holidaysAreLeaveDays) return new Set();
  return new Set((await wardHolidays(wardId, `${year}-01-01`, `${year}-12-31`, db)).keys());
}

export async function wardSettings(wardId: string) {
  const ward = await prisma.ward.findUniqueOrThrow({ where: { id: wardId }, include: { holidays: { orderBy: { date: "asc" } } } });
  return {
    name: ward.name, state: isState(ward.state) ? ward.state : null, leaveCountMode: ward.leaveCountMode as CountMode, holidaysAreLeaveDays: ward.holidaysAreLeaveDays,
    extra: ward.holidays.map((h) => ({ id: h.id, date: toYmd(h.date), name: h.name })),
  };
}

export async function updateWardSettings(actorId: string, input: { state: string | null; leaveCountMode: CountMode; holidaysAreLeaveDays?: boolean }) {
  if (input.state !== null && !isState(input.state)) throw new AdminError("Unbekanntes Bundesland.");
  if (input.leaveCountMode !== "WEEKDAYS" && input.leaveCountMode !== "ALL_DAYS") throw new AdminError("Unbekannte Zählweise.");
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    const before = await tx.ward.findUniqueOrThrow({ where: { id: me.wardId } });
    const holidaysAreLeaveDays = input.holidaysAreLeaveDays ?? before.holidaysAreLeaveDays;
    await tx.ward.update({ where: { id: me.wardId }, data: { state: input.state, leaveCountMode: input.leaveCountMode, holidaysAreLeaveDays } });
    await tx.userAudit.create({
      data: { actorId, action: "WARD_SETTINGS", detail: { from: { state: before.state, leaveCountMode: before.leaveCountMode, holidaysAreLeaveDays: before.holidaysAreLeaveDays }, to: { ...input, holidaysAreLeaveDays } } },
    });
  });
}

export async function addWardHoliday(actorId: string, input: Holiday) {
  if (!isYmd(input.date)) throw new AdminError("Bitte ein gültiges Datum angeben."); // strict: 2026-02-30 is rejected, not moved to March
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new AdminError("Bitte einen Namen angeben.");
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    try {
      await tx.wardHoliday.create({ data: { wardId: me.wardId, date: toDate(input.date), name } });
    } catch (e) {
      // unique (ward, date): also covers two requests at the same time (double click)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AdminError("Für diesen Tag gibt es schon einen Eintrag.");
      throw e;
    }
  });
}

export async function removeWardHoliday(actorId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    await tx.wardHoliday.deleteMany({ where: { id, wardId: me.wardId } });
  });
}

