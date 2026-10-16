import { validateRoster, type Assignment, type RuleConfig, type ShiftTypeDef, type Violation, DEFAULT_RULES } from "./rules";

/** The two shifts involved. `partnerDate` is null for a hand-over (the partner gives nothing back). */
export interface SwapSpec {
  requesterId: string;
  partnerId: string;
  date: string;
  shiftTypeId: string;
  partnerDate: string | null;
  partnerShiftTypeId: string | null;
}

/** Final state of single roster cells after the swap (null = empty). */
export interface CellChange { userId: string; date: string; shiftTypeId: string | null }

export class SwapConflict extends Error {}

const at = (a: Assignment[], userId: string, date: string) => a.find((x) => x.userId === userId && x.date === date)?.shiftTypeId ?? null;

/**
 * Cells that change when the swap is applied. Throws SwapConflict (German message) when the roster no longer matches the request
 * or a target cell is already taken.
 */
export function swapChanges(spec: SwapSpec, roster: Assignment[]): CellChange[] {
  const { requesterId: r, partnerId: p, date: d1, shiftTypeId: t1 } = spec;
  if (r === p) throw new SwapConflict("Ein Tausch mit dir selbst ist nicht möglich.");
  if (at(roster, r, d1) !== t1) throw new SwapConflict("Der angebotene Dienst steht nicht mehr so im Plan.");
  if (spec.partnerDate === null) {
    if (at(roster, p, d1) !== null) throw new SwapConflict("Die Kollegin/der Kollege hat an diesem Tag bereits einen Eintrag.");
    return [{ userId: r, date: d1, shiftTypeId: null }, { userId: p, date: d1, shiftTypeId: t1 }];
  }
  const d2 = spec.partnerDate, t2 = spec.partnerShiftTypeId;
  if (!t2 || at(roster, p, d2) !== t2) throw new SwapConflict("Der Dienst der Kollegin/des Kollegen steht nicht mehr so im Plan.");
  if (d1 === d2) return [{ userId: r, date: d1, shiftTypeId: t2 }, { userId: p, date: d1, shiftTypeId: t1 }];
  if (at(roster, p, d1) !== null) throw new SwapConflict("Die Kollegin/der Kollege hat am Tag deines Dienstes bereits einen Eintrag.");
  if (at(roster, r, d2) !== null) throw new SwapConflict("Du hast am Tag des anderen Dienstes bereits einen Eintrag.");
  return [
    { userId: r, date: d1, shiftTypeId: null }, { userId: p, date: d1, shiftTypeId: t1 },
    { userId: p, date: d2, shiftTypeId: null }, { userId: r, date: d2, shiftTypeId: t2 },
  ];
}

export function applyChanges(roster: Assignment[], changes: CellChange[]): Assignment[] {
  const touched = new Set(changes.map((c) => `${c.userId}|${c.date}`));
  const rest = roster.filter((a) => !touched.has(`${a.userId}|${a.date}`));
  return [...rest, ...changes.flatMap((c) => (c.shiftTypeId ? [{ userId: c.userId, date: c.date, shiftTypeId: c.shiftTypeId }] : []))];
}

const key = (v: Violation) => JSON.stringify(v);

/** Rule violations the swap would introduce (violations that already existed are ignored). Staffing is not checked: a swap keeps the headcount per day unless dates differ. */
export function newViolations(roster: Assignment[], changes: CellChange[], types: ShiftTypeDef[], cfg: RuleConfig = DEFAULT_RULES): Violation[] {
  const users = new Set(changes.map((c) => c.userId));
  const scoped = (a: Assignment[]) => a.filter((x) => users.has(x.userId));
  const rules = { ...cfg, minStaffing: {} };
  const before = new Set(validateRoster(scoped(roster), types, rules).map(key));
  return validateRoster(scoped(applyChanges(roster, changes)), types, rules).filter((v) => !before.has(key(v)));
}
