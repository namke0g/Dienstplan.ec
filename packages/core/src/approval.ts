export type PlanStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "PUBLISHED";

export type Reviewer = "PDL" | "BETRIEBSRAT";
export type Decision = "PENDING" | "APPROVED" | "REJECTED";

export const REVIEWERS: readonly Reviewer[] = ["PDL", "BETRIEBSRAT"];

export interface PlanState {
  status: PlanStatus;
  version: number;
  decisions: Record<Reviewer, Decision>;
}

export class TransitionError extends Error {}

const pending = (): Record<Reviewer, Decision> => ({
  PDL: "PENDING",
  BETRIEBSRAT: "PENDING",
});

export const newPlan = (): PlanState => ({
  status: "DRAFT",
  version: 1,
  decisions: pending(),
});

/** Planner submits a draft (or a revised plan) for review. Both reviewers start pending. */
export function submit(p: PlanState): PlanState {
  if (p.status !== "DRAFT" && p.status !== "CHANGES_REQUESTED") {
    throw new TransitionError(`Cannot submit a plan in status ${p.status}`);
  }
  return { ...p, status: "IN_REVIEW", decisions: pending() };
}

/**
 * Parallel review: PDL and Betriebsrat decide independently.
 * Any rejection sends the plan back; approval needs both.
 */
export function review(p: PlanState, who: Reviewer, decision: "APPROVED" | "REJECTED"): PlanState {
  if (p.status !== "IN_REVIEW") {
    throw new TransitionError(`Cannot review a plan in status ${p.status}`);
  }
  if (p.decisions[who] !== "PENDING") {
    throw new TransitionError(`${who} has already decided on this version`);
  }
  const decisions = { ...p.decisions, [who]: decision };
  if (decision === "REJECTED") return { ...p, decisions, status: "CHANGES_REQUESTED" };
  const all = REVIEWERS.every((r) => decisions[r] === "APPROVED");
  return { ...p, decisions, status: all ? "APPROVED" : "IN_REVIEW" };
}

/** Publishing is only possible once both reviewers approved the current version. */
export function publish(p: PlanState): PlanState {
  if (p.status !== "APPROVED" || !REVIEWERS.every((r) => p.decisions[r] === "APPROVED")) {
    throw new TransitionError("Plan needs approval from PDL and Betriebsrat before publishing");
  }
  return { ...p, status: "PUBLISHED" };
}

/** Any edit to a reviewed/published plan creates a new version that needs fresh approval. */
export function edit(p: PlanState): PlanState {
  if (p.status === "DRAFT" || p.status === "CHANGES_REQUESTED") return p;
  return { status: "DRAFT", version: p.version + 1, decisions: pending() };
}
