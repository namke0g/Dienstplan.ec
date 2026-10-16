import { holidayMap, isState, STATES, type CountMode, type Holiday } from "@dienstplan/core";
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

export async function wardSettings(wardId: string) {
  const ward = await prisma.ward.findUniqueOrThrow({ where: { id: wardId }, include: { holidays: { orderBy: { date: "asc" } } } });
  return {
    name: ward.name, state: isState(ward.state) ? ward.state : null, leaveCountMode: ward.leaveCountMode as CountMode,
    extra: ward.holidays.map((h) => ({ id: h.id, date: toYmd(h.date), name: h.name })),
  };
}

export async function updateWardSettings(actorId: string, input: { state: string | null; leaveCountMode: CountMode }) {
  if (input.state !== null && !isState(input.state)) throw new AdminError("Unbekanntes Bundesland.");
  if (input.leaveCountMode !== "WEEKDAYS" && input.leaveCountMode !== "ALL_DAYS") throw new AdminError("Unbekannte Zählweise.");
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    const before = await tx.ward.findUniqueOrThrow({ where: { id: me.wardId } });
    await tx.ward.update({ where: { id: me.wardId }, data: { state: input.state, leaveCountMode: input.leaveCountMode } });
    await tx.userAudit.create({ data: { actorId, action: "WARD_SETTINGS", detail: { from: { state: before.state, leaveCountMode: before.leaveCountMode }, to: input } } });
  });
}

export async function addWardHoliday(actorId: string, input: Holiday) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) throw new AdminError("Bitte ein gültiges Datum angeben.");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new AdminError("Bitte einen Namen angeben.");
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    if (await tx.wardHoliday.findUnique({ where: { wardId_date: { wardId: me.wardId, date: toDate(input.date) } } })) throw new AdminError("Für diesen Tag gibt es schon einen Eintrag.");
    await tx.wardHoliday.create({ data: { wardId: me.wardId, date: toDate(input.date), name } });
  });
}

export async function removeWardHoliday(actorId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const me = await actor(tx, actorId, ["ADMIN"]);
    await tx.wardHoliday.deleteMany({ where: { id, wardId: me.wardId } });
  });
}

