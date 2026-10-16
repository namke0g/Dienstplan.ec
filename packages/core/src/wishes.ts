/** A wish of an employee for one day: a day off ("Wunschfrei") or a particular shift. */
export interface Wish { userId: string; date: string; kind: "FREE" | "SHIFT"; shiftTypeId: string | null }
export type WishState = "met" | "unmet" | "open";

/**
 * Whether the roster meets a wish. `assigned` is the shift type on that day (null = free), `kindOf` the kind of a shift type.
 * Wunschfrei is met by any absence or a free day and missed by a work shift. A shift wish is met by exactly that shift; a
 * free day is still "open" (the planner can still assign it), anything else misses it.
 */
export function wishState(w: Wish, assigned: string | null, kindOf: (id: string) => string | undefined): WishState {
  if (w.kind === "FREE") return assigned && kindOf(assigned) === "WORK" ? "unmet" : "met";
  if (!w.shiftTypeId) return "open"; // the wished shift type no longer exists
  if (assigned === w.shiftTypeId) return "met";
  return assigned === null ? "open" : "unmet";
}

export function wishSummary(wishes: Wish[], roster: Record<string, string>, kindOf: (id: string) => string | undefined) {
  const states = wishes.map((w) => ({ wish: w, state: wishState(w, roster[`${w.userId}|${w.date}`] ?? null, kindOf) }));
  return { total: wishes.length, met: states.filter((s) => s.state === "met").length, unmet: states.filter((s) => s.state === "unmet"), states };
}
