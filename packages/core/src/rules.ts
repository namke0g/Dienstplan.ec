export interface ShiftTypeDef {
  id: string;
  /** minutes from midnight */
  startMin: number;
  /** minutes from midnight; if <= startMin the shift ends the next day */
  endMin: number;
  /** absences (Urlaub, Krank, Sonderurlaub) are all-day and never count as work */
  kind?: "WORK" | "VACATION" | "SPECIAL_LEAVE" | "SICK";
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
  const isWork = (a: Assignment) => (byType.get(a.shiftTypeId)?.kind ?? "WORK") === "WORK";
  // absences are neither working days, nor do they break rest-time or staffing rules
  assignments = assignments.filter(isWork);
  const out: Violation[] = [];
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
