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

export const ABSENT_ID = "__absent";
export const ABSENT_TYPE = { id: ABSENT_ID, code: "–", name: "Abwesend", color: "#94a3b8", kind: "VACATION" as const, paid: true };

/** Sick leave is health data (DSGVO Art. 9): only the person themself, planners and PDL see the reason; everyone else sees "abwesend". */
export function maskSick<T extends { userId: string; shiftTypeId: string }>(
  shifts: T[], types: { id: string; kind: string }[], viewerId: string, canSeeSick: boolean,
): T[] {
  if (canSeeSick) return shifts;
  const sick = new Set(types.filter((t) => t.kind === "SICK").map((t) => t.id));
  return shifts.map((s) => (sick.has(s.shiftTypeId) && s.userId !== viewerId ? { ...s, shiftTypeId: ABSENT_ID } : s));
}
export const canSeeSick = (role: string) => role === "PLANNER" || role === "ADMIN" || role === "PDL";
export const toGridTypes = (types: { id: string; code: string; name: string; color: string; kind: string; paid: boolean }[]) =>
  types.map(({ id, code, name, color, kind, paid }) => ({ id, code, name, color, kind, paid }));
