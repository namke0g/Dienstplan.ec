/** How leave days are counted: Mon–Fri only (usual for a 5-day-week entitlement) or every calendar day. */
export type CountMode = "WEEKDAYS" | "ALL_DAYS";

const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
export const countsAsDay = (ymd: string, mode: CountMode) => mode === "ALL_DAYS" || (dow(ymd) >= 1 && dow(ymd) <= 5);
export const countDays = (days: string[], mode: CountMode) => [...new Set(days)].filter((d) => countsAsDay(d, mode)).length;

export interface Entitlement {
  year: number;
  /** Jahresanspruch */
  entitlement: number;
  /** Resturlaub aus dem Vorjahr */
  carryOver: number;
  /** last day on which the carry-over can still be used (YYYY-MM-DD); null = never expires */
  carryOverExpires: string | null;
  /** manual correction (+/-) */
  adjustment: number;
}

export interface BalanceInput {
  ent: Entitlement;
  today: string;
  mode: CountMode;
  /** dates in `ent.year` that carry a leave-consuming entry in the roster */
  inRoster: string[];
  /** dates of open (not yet decided) requests */
  requested: string[];
  /** dates of approved requests that are not in the roster yet */
  held: string[];
}

export interface Balance {
  year: number;
  total: number; // entitlement + valid carry-over + adjustment
  entitlement: number;
  carryOver: number;
  adjustment: number;
  /** days already taken (roster dates before today) */
  taken: number;
  /** days planned in the roster from today on */
  planned: number;
  /** approved, but not in the roster yet */
  approvedHeld: number;
  /** open requests */
  requested: number;
  /** carry-over that already lapsed */
  forfeited: number;
  /** carry-over that will lapse on `carryOverExpires` unless used (0 once expired) */
  expiring: number;
  remaining: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function computeBalance({ ent, today, mode, inRoster, requested, held }: BalanceInput): Balance {
  const inYear = (d: string) => d.startsWith(`${ent.year}-`);
  const roster = [...new Set(inRoster)].filter(inYear).filter((d) => countsAsDay(d, mode));
  const taken = roster.filter((d) => d < today).length;
  const planned = roster.length - taken;
  const req = countDays(requested.filter(inYear), mode);
  const hld = countDays(held.filter(inYear), mode);

  const exp = ent.carryOverExpires;
  const usedByExpiry = exp ? countDays([...roster, ...held.filter(inYear), ...requested.filter(inYear)].filter((d) => d <= exp), mode) : Infinity;
  const lapse = Math.max(0, ent.carryOver - usedByExpiry);
  const expired = exp !== null && today > exp;
  const forfeited = expired ? lapse : 0;
  const expiring = exp !== null && !expired ? lapse : 0;

  const total = ent.entitlement + ent.carryOver + ent.adjustment - forfeited;
  const remaining = total - taken - planned - hld - req;
  return {
    year: ent.year, total: round(total), entitlement: ent.entitlement, carryOver: ent.carryOver, adjustment: ent.adjustment,
    taken, planned, approvedHeld: hld, requested: req, forfeited: round(forfeited), expiring: round(expiring), remaining: round(remaining),
  };
}
