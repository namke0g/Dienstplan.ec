/** WORK is a normal shift; everything else is an absence that fills the day without working. */
export type ShiftKind = "WORK" | "VACATION" | "UNPAID_LEAVE" | "SICK_PAID" | "SICK_UNPAID" | "SPECIAL_LEAVE";

export const LEAVE_KINDS: ShiftKind[] = ["VACATION", "UNPAID_LEAVE", "SICK_PAID", "SICK_UNPAID", "SPECIAL_LEAVE"];
export const isLeave = (kind: ShiftKind | undefined): boolean => !!kind && kind !== "WORK";

export const KIND_LABEL: Record<ShiftKind, string> = {
  WORK: "Dienst",
  VACATION: "Urlaub",
  UNPAID_LEAVE: "Unbezahlter Urlaub",
  SICK_PAID: "Krank (bezahlt)",
  SICK_UNPAID: "Krank (unbezahlt)",
  SPECIAL_LEAVE: "Sonderurlaub",
};

/** Whether the employer keeps paying for the day. */
export const isPaidKind = (kind: ShiftKind): boolean => kind !== "UNPAID_LEAVE" && kind !== "SICK_UNPAID";

export interface ShiftTypeDef {
  id: string;
  /** defaults to WORK */
  kind?: ShiftKind;
  /** minutes from midnight */
  startMin: number;
  /** minutes from midnight; if <= startMin the shift ends the next day */
  endMin: number;
}

export interface Assignment {
  userId: string;
  /** YYYY-MM-DD */
  date: string;
  shiftTypeId: string;
}

export type Violation =
  | { rule: "REST_TIME"; userId: string; date: string; restHours: number }
  | { rule: "MAX_CONSECUTIVE"; userId: string; date: string; days: number }
  | { rule: "MIN_STAFFING"; date: string; shiftTypeId: string; have: number; need: number };

export interface RuleConfig {
  minRestHours: number;
  maxConsecutiveDays: number;
  /** key `${shiftTypeId}` -> required headcount per day */
  minStaffing: Record<string, number>;
}

export const DEFAULT_RULES: RuleConfig = { minRestHours: 11, maxConsecutiveDays: 6, minStaffing: {} };

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

export function validateRoster(
  assignments: Assignment[],
  types: ShiftTypeDef[],
  cfg: RuleConfig = DEFAULT_RULES,
): Violation[] {
  const byType = new Map(types.map((t) => [t.id, t]));
  const out: Violation[] = [];
  // absences are not work: they break a streak, need no rest time and do not count towards staffing
  assignments = assignments.filter((a) => !isLeave(byType.get(a.shiftTypeId)?.kind));
  const perUser = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!byType.has(a.shiftTypeId)) throw new Error(`Unknown shift type ${a.shiftTypeId}`);
    (perUser.get(a.userId) ?? perUser.set(a.userId, []).get(a.userId)!).push(a);
  }

  for (const [userId, list] of perUser) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let streak = 1;
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]!;
      const prev = list[i - 1];
      if (prev) {
        const gap = dayNum(cur.date) - dayNum(prev.date);
        streak = gap === 1 ? streak + 1 : gap === 0 ? streak : 1;
        if (gap === 1 && streak === cfg.maxConsecutiveDays + 1) {
          out.push({ rule: "MAX_CONSECUTIVE", userId, date: cur.date, days: streak });
        }
        if (gap <= 1) {
          const pt = byType.get(prev.shiftTypeId)!;
          const ct = byType.get(cur.shiftTypeId)!;
          const prevEnd = dayNum(prev.date) * 1440 + (pt.endMin <= pt.startMin ? pt.endMin + 1440 : pt.endMin);
          const curStart = dayNum(cur.date) * 1440 + ct.startMin;
          const rest = (curStart - prevEnd) / 60;
          if (rest < cfg.minRestHours) out.push({ rule: "REST_TIME", userId, date: cur.date, restHours: rest });
        }
      }
    }
  }

  const counts = new Map<string, number>();
  for (const a of assignments) {
    const k = `${a.date}|${a.shiftTypeId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dates = [...new Set(assignments.map((a) => a.date))].sort();
  for (const date of dates) {
    for (const [shiftTypeId, need] of Object.entries(cfg.minStaffing)) {
      const have = counts.get(`${date}|${shiftTypeId}`) ?? 0;
      if (have < need) out.push({ rule: "MIN_STAFFING", date, shiftTypeId, have, need });
    }
  }
  return out;
}
