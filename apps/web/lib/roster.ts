import { prisma, toYmd, toDate, daysInMonth, type SnapshotShift } from "@dienstplan/db";
import { validateRoster, DEFAULT_RULES, type Assignment, type Violation } from "@dienstplan/core";

export async function wardContext(wardId: string) {
  const [staff, types] = await Promise.all([
    prisma.user.findMany({ where: { wardId, active: true, role: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.shiftType.findMany({ where: { wardId }, orderBy: { startMin: "asc" } }),
  ]);
  return { staff, types };
}

export async function planFor(wardId: string, month: string) {
  return prisma.plan.findUnique({ where: { wardId_month: { wardId, month: toDate(`${month}-01`) } } });
}

export async function draftShifts(planId: string): Promise<SnapshotShift[]> {
  const rows = await prisma.shift.findMany({ where: { planId } });
  return rows.map((s) => ({ id: s.id, userId: s.userId, date: toYmd(s.date), shiftTypeId: s.shiftTypeId, sequence: s.sequence }));
}

export const snapshotOf = (p: { publishedSnapshot: unknown } | null): SnapshotShift[] => ((p?.publishedSnapshot ?? []) as SnapshotShift[]);

export function violationsFor(shifts: SnapshotShift[], types: { id: string; startMin: number; endMin: number }[], minStaffing: Record<string, number> = {}): Violation[] {
  const a: Assignment[] = shifts.map((s) => ({ userId: s.userId, date: s.date, shiftTypeId: s.shiftTypeId }));
  return validateRoster(a, types, { ...DEFAULT_RULES, minStaffing });
}

export const describeViolation = (v: Violation, names: Map<string, string>, typeName: Map<string, string>) => {
  switch (v.rule) {
    case "REST_TIME": return `${names.get(v.userId)}: nur ${Math.max(0, v.restHours).toFixed(1).replace(".0", "")} h Ruhezeit vor dem ${v.date.split("-").reverse().join(".")}`;
    case "MAX_CONSECUTIVE": return `${names.get(v.userId)}: ${v.days}. Arbeitstag in Folge am ${v.date.split("-").reverse().join(".")}`;
    case "MIN_STAFFING": return `${v.date.split("-").reverse().join(".")}: ${typeName.get(v.shiftTypeId)} unterbesetzt (${v.have}/${v.need})`;
  }
};

export { daysInMonth };
