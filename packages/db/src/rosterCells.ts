import type { Prisma } from "@prisma/client";
import { toDate, toYmd } from "./dates";
import { lockPlan, type SnapshotShift, type Tx } from "./service";

/** A cell's current value: the draft roster row and (only if the month is published) the published copy. */
export interface CellNow { userId: string; date: string; draft: string | null; published?: string | null }
/** What to write: undefined leaves that copy unchanged; null clears it. */
export interface CellValue { draft?: string | null; published?: string | null }
export interface CellWrite { userId: string; date: string; value: (now: CellNow) => CellValue }

/**
 * The one place that changes roster cells *outside* the plan workflow (swaps, sick reports): writes the draft row and the
 * published copy together, keeps calendar-feed ids and sequence numbers stable, and writes one audit entry per month.
 * Rows of a month are loaded with a single query. Returns every cell's value before the write.
 */
export async function writeRosterCells(tx: Tx, wardId: string, writes: CellWrite[], audit: { actorId: string; action: string; detail?: Prisma.InputJsonValue }): Promise<CellNow[]> {
  const before: CellNow[] = [];
  const byMonth = new Map<string, CellWrite[]>();
  for (const w of writes) byMonth.set(w.date.slice(0, 7), [...(byMonth.get(w.date.slice(0, 7)) ?? []), w]);

  for (const [month, items] of byMonth) {
    const { id: planId } = await tx.plan.upsert({ where: { wardId_month: { wardId, month: toDate(`${month}-01`) } }, update: {}, create: { wardId, month: toDate(`${month}-01`) }, select: { id: true } });
    await lockPlan(tx, planId); // concurrent writers of the same month must not overwrite each other's published copy
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
    const rows = new Map((await tx.shift.findMany({
      where: { planId: plan.id, OR: items.map((i) => ({ userId: i.userId, date: toDate(i.date) })) },
    })).map((r) => [`${r.userId}|${toYmd(r.date)}`, r]));
    let snap = plan.publishedSnapshot == null ? null : (plan.publishedSnapshot as unknown as SnapshotShift[]).slice();
    const snapAt = new Map((snap ?? []).map((s) => [`${s.userId}|${s.date}`, s]));

    for (const w of items) {
      const key = `${w.userId}|${w.date}`;
      const row = rows.get(key);
      const inSnap = snapAt.get(key);
      const now: CellNow = { userId: w.userId, date: w.date, draft: row?.shiftTypeId ?? null, ...(snap ? { published: inSnap?.shiftTypeId ?? null } : {}) };
      before.push(now);
      const v = w.value(now);

      let rowId = row?.id ?? null, seq = row?.sequence ?? 0;
      if (v.draft !== undefined && v.draft !== now.draft) {
        const where = { planId_userId_date: { planId: plan.id, userId: w.userId, date: toDate(w.date) } };
        if (v.draft === null) { await tx.shift.delete({ where }); rowId = null; }
        else if (row) { const u = await tx.shift.update({ where, data: { shiftTypeId: v.draft, sequence: { increment: 1 } } }); seq = u.sequence; }
        else { const c = await tx.shift.create({ data: { planId: plan.id, userId: w.userId, date: toDate(w.date), shiftTypeId: v.draft } }); rowId = c.id; seq = 0; }
      }
      if (snap && v.published !== undefined && v.published !== now.published) {
        snap = snap.filter((s) => s !== inSnap);
        if (v.published !== null) {
          // stable id for the calendar feed: the row's id where there is one; a higher sequence so subscribed calendars update
          snap.push({ id: rowId ?? inSnap?.id ?? `${w.userId}-${w.date}`, userId: w.userId, date: w.date, shiftTypeId: v.published, sequence: Math.max(seq, (inSnap?.sequence ?? -1) + 1) });
        }
      }
    }
    if (snap) await tx.plan.update({ where: { id: plan.id }, data: { publishedSnapshot: snap as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { planId: plan.id, actorId: audit.actorId, action: audit.action, detail: audit.detail ?? { cells: items.map((i) => ({ userId: i.userId, date: i.date })) } } });
  }
  return before;
}
