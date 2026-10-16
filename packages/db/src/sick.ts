import type { Prisma, Role } from "@prisma/client";
import { eachDay, isYmd, localToday } from "@dienstplan/core";
import { prisma } from "./client";
import { toDate, toYmd } from "./dates";
import { writeRosterCells } from "./rosterCells";
import { ForbiddenError, type Tx } from "./service";

export class SickError extends Error {}

const MAX_DAYS = 42; // one report covers at most six weeks (the period of continued pay); longer sickness: extend
const BACKDATE_DAYS = 7;
const MANAGERS: Role[] = ["PLANNER", "ADMIN", "PDL"];
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const todayYmd = () => localToday(); // the ward's local date, not UTC
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const label = (d: string) => `${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}.`;

/** What a sick day replaced: the draft roster cell and the published one (undefined = month not published). */
interface Replaced { date: string; draft: string | null; published?: string | null }

/** The person themselves, or a planner/PDL/admin of the same ward reporting on their behalf (e.g. after a phone call). */
async function reporter(tx: Tx, actorId: string, userId: string) {
  const [me, target] = await Promise.all([tx.user.findUniqueOrThrow({ where: { id: actorId } }), tx.user.findUnique({ where: { id: userId } })]);
  if (!target || target.role !== "EMPLOYEE" || !target.active || target.wardId !== me.wardId) throw new ForbiddenError("Für diese Person kann keine Krankmeldung erfasst werden.");
  if (me.id !== target.id && !MANAGERS.includes(me.role)) throw new ForbiddenError("Krankmeldungen für andere erfassen nur Planung, PDL oder Admin.");
  return { me, target };
}

/** One person's sick-report changes run one after another (two quick taps must not create overlapping reports). */
const lockPerson = (tx: Tx, userId: string) => tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${userId}))) AS l`;

async function writeSickDays(tx: Tx, wardId: string, userId: string, actorId: string, dates: string[], typeId: string, action: string): Promise<Replaced[]> {
  const before = await writeRosterCells(tx, wardId, dates.map((date) => ({ userId, date, value: () => ({ draft: typeId, published: typeId }) })), { actorId, action, detail: { userId, days: dates } });
  return before.map(({ date, draft, published }) => ({ date, draft, ...(published !== undefined ? { published } : {}) }));
}

async function notifyPlanners(tx: Tx, wardId: string, rows: { title: string; body: string; shortNotice: boolean }) {
  const planners = await tx.user.findMany({ where: { wardId, active: true, role: { in: ["PLANNER", "PDL"] } }, select: { id: true } });
  if (planners.length) await tx.notification.createMany({ data: planners.map((p) => ({ userId: p.id, type: "SICK_REPORTED", ...rows })) });
}

/** "Ausfall: Frühdienst Fr 17.10., Spätdienst Sa 18.10." from the shifts that were planned on the sick days. */
async function lostShifts(tx: Tx, before: Replaced[]) {
  const ids = [...new Set(before.map((b) => b.published !== undefined ? b.published : b.draft).filter((x): x is string => !!x))];
  const types = new Map((await tx.shiftType.findMany({ where: { id: { in: ids } } })).map((t) => [t.id, t]));
  return before.flatMap((b) => {
    const t = types.get((b.published !== undefined ? b.published : b.draft) ?? "");
    return t && t.kind === "WORK" ? [`${t.name} ${label(b.date)}`] : [];
  });
}

async function sickType(tx: Tx, wardId: string) {
  const t = await tx.shiftType.findFirst({ where: { wardId, kind: "SICK" }, orderBy: [{ paid: "desc" }, { code: "asc" }] });
  if (!t) throw new SickError("Für diese Station ist keine Dienstart für Krankheit angelegt.");
  return t;
}

function checkRange(start: string, end: string, today: string) {
  if (!isYmd(start) || !isYmd(end)) throw new SickError("Bitte gültige Daten angeben.");
  if (end < start) throw new SickError("Das Ende liegt vor dem Beginn.");
  if (start < addDays(today, -BACKDATE_DAYS)) throw new SickError(`Krankmeldungen können höchstens ${BACKDATE_DAYS} Tage rückwirkend erfasst werden.`);
  if (eachDay(start, end).length > MAX_DAYS) throw new SickError(`Eine Krankmeldung umfasst höchstens ${MAX_DAYS} Tage. Bei längerer Krankheit bitte später verlängern.`);
}

/** Short notice: a changed day falls within the next three days (back-dated days are not short notice). */
const shortNotice = (dates: string[], today: string) => dates.some((d) => d >= today && d <= addDays(today, 3));

/** Reports that ended more than a week ago are closed: changing them would rewrite old, already settled rosters. */
function assertOpen(r: { end: Date }, today: string) {
  if (toYmd(r.end) < addDays(today, -BACKDATE_DAYS)) throw new SickError("Diese Krankmeldung ist abgeschlossen und kann nicht mehr geändert werden.");
}

export async function createSickReport(actorId: string, input: { userId?: string; start: string; end: string; note?: string }, today = todayYmd()) {
  checkRange(input.start, input.end, today);
  return prisma.$transaction(async (tx) => {
    await lockPerson(tx, input.userId ?? actorId);
    const { me, target } = await reporter(tx, actorId, input.userId ?? actorId);
    const overlap = await tx.sickReport.findFirst({ where: { userId: target.id, start: { lte: toDate(input.end) }, end: { gte: toDate(input.start) } } });
    if (overlap) throw new SickError("Für diesen Zeitraum gibt es schon eine Krankmeldung. Bitte diese verlängern.");
    const type = await sickType(tx, target.wardId);
    const days = eachDay(input.start, input.end);
    const before = await writeSickDays(tx, target.wardId, target.id, actorId, days, type.id, "SICK_REPORTED");
    const report = await tx.sickReport.create({
      data: { userId: target.id, wardId: target.wardId, start: toDate(input.start), end: toDate(input.end), note: input.note?.trim().slice(0, 200) || null, reportedById: me.id, replaced: before as unknown as Prisma.InputJsonValue },
    });
    const lost = await lostShifts(tx, before);
    await notifyPlanners(tx, target.wardId, {
      title: `Krankmeldung: ${target.name}`, shortNotice: shortNotice(days, today),
      body: `${label(input.start)}–${label(input.end)}. ${lost.length ? `Ausfall: ${lost.join(", ")}` : "Keine geplanten Dienste betroffen."}`,
    });
    if (me.id !== target.id) await tx.notification.create({ data: { userId: target.id, type: "SICK_REPORTED", title: "Krankmeldung erfasst", body: `${me.name} hat dich für ${label(input.start)}–${label(input.end)} krankgemeldet. Gute Besserung!` } });
    return { report, lost };
  });
}

async function loadOwnOrManaged(tx: Tx, actorId: string, id: string, today: string) {
  const found = await tx.sickReport.findUnique({ where: { id }, select: { userId: true } });
  if (!found) throw new SickError("Krankmeldung nicht gefunden.");
  await lockPerson(tx, found.userId);
  const r = await tx.sickReport.findUnique({ where: { id }, include: { user: true } }); // re-read under the lock
  if (!r) throw new SickError("Krankmeldung nicht gefunden.");
  await reporter(tx, actorId, r.userId);
  assertOpen(r, today);
  return r;
}

/** Longer sick: the new days become sick days too. */
export async function extendSickReport(actorId: string, id: string, newEnd: string, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const r = await loadOwnOrManaged(tx, actorId, id, today);
    const end = toYmd(r.end);
    if (!isYmd(newEnd) || newEnd <= end) throw new SickError("Das neue Ende muss nach dem bisherigen liegen.");
    if (eachDay(toYmd(r.start), newEnd).length > MAX_DAYS) throw new SickError(`Eine Krankmeldung umfasst höchstens ${MAX_DAYS} Tage. Bitte danach eine neue Krankmeldung erfassen.`);
    const clash = await tx.sickReport.findFirst({ where: { userId: r.userId, id: { not: r.id }, start: { lte: toDate(newEnd) }, end: { gt: r.end } } });
    if (clash) throw new SickError("Der verlängerte Zeitraum überschneidet sich mit einer anderen Krankmeldung.");
    const type = await sickType(tx, r.wardId);
    const added = eachDay(addDays(end, 1), newEnd);
    const before = await writeSickDays(tx, r.wardId, r.userId, actorId, added, type.id, "SICK_EXTENDED");
    await tx.sickReport.update({ where: { id }, data: { end: toDate(newEnd), replaced: [...(r.replaced as unknown as Replaced[]), ...before] as unknown as Prisma.InputJsonValue } });
    const lost = await lostShifts(tx, before);
    await notifyPlanners(tx, r.wardId, {
      title: `Krankmeldung verlängert: ${r.user.name}`, shortNotice: shortNotice(added, today),
      body: `Jetzt bis ${label(newEnd)}. ${lost.length ? `Weiterer Ausfall: ${lost.join(", ")}` : "Keine weiteren geplanten Dienste betroffen."}`,
    });
  });
}

/**
 * Back at work from `backOn` (first healthy day). Sick days from then on get back what was planned before, unless the planner has
 * changed that day in the meantime. `backOn` = first sick day withdraws the whole report (e.g. entered by mistake).
 */
export async function endSickReport(actorId: string, id: string, backOn: string, today = todayYmd()) {
  return prisma.$transaction(async (tx) => {
    const r = await loadOwnOrManaged(tx, actorId, id, today);
    const start = toYmd(r.start), end = toYmd(r.end);
    if (!isYmd(backOn) || backOn < start || backOn > end) throw new SickError(`Bitte einen Tag zwischen ${label(start)} und ${label(end)} angeben.`);
    const type = await sickType(tx, r.wardId);
    const replaced = r.replaced as unknown as Replaced[];
    const restore = replaced.filter((x) => x.date >= backOn);
    // each copy (draft, published) gets its old value back only while it still shows the sick entry: a planner's later change wins.
    // A month published after the report shows the sick entry in its published copy too; that copy gets the value from before.
    const skipped: string[] = [];
    await writeRosterCells(tx, r.wardId, restore.map((x) => ({
      userId: r.userId, date: x.date,
      value: (now) => {
        const draft = now.draft === type.id ? x.draft : undefined;
        const published = now.published === type.id ? (x.published !== undefined ? x.published : x.draft) : undefined;
        if (draft === undefined && (now.published === undefined || published === undefined)) skipped.push(x.date);
        return { draft, published };
      },
    })), { actorId, action: "SICK_ENDED", detail: { userId: r.userId, days: restore.map((x) => x.date) } });
    if (backOn === start) await tx.sickReport.delete({ where: { id } });
    else await tx.sickReport.update({ where: { id }, data: { end: toDate(addDays(backOn, -1)), replaced: replaced.filter((x) => x.date < backOn) as unknown as Prisma.InputJsonValue } });
    await notifyPlanners(tx, r.wardId, {
      title: backOn === start ? `Krankmeldung zurückgenommen: ${r.user.name}` : `Wieder einsatzbereit: ${r.user.name}`, shortNotice: shortNotice(restore.map((x) => x.date), today),
      body: `${backOn === start ? "" : `Ab ${label(backOn)}. `}${skipped.length === restore.length && restore.length ? "Diese Tage wurden inzwischen umgeplant und bleiben unverändert." : `Die vorher geplanten Dienste stehen wieder im Plan.${skipped.length ? ` Inzwischen umgeplant und unverändert: ${skipped.map(label).join(", ")}.` : ""}`}`,
    });
  });
}

/** Planners/PDL/admin: current and upcoming reports of the ward (and the last week). Employees: their own. */
export async function sickReportsFor(actorId: string, today = todayYmd()) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  const where = MANAGERS.includes(me.role) ? { wardId: me.wardId, end: { gte: toDate(addDays(today, -BACKDATE_DAYS)) } } : { userId: me.id };
  const rows = await prisma.sickReport.findMany({ where, orderBy: { start: "desc" }, take: 50, include: { user: { select: { name: true } }, reportedBy: { select: { name: true } } } });
  return rows.map((r) => ({ id: r.id, userId: r.userId, name: r.user.name, start: toYmd(r.start), end: toYmd(r.end), note: r.note, reportedBy: r.reportedBy.name, selfReported: r.reportedById === r.userId, active: toYmd(r.end) >= today }));
}

