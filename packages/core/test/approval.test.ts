import { describe, expect, it } from "vitest";
import { edit, newPlan, publish, review, submit, TransitionError } from "../src";

const inReview = () => submit(newPlan());

describe("approval workflow", () => {
  it("needs both PDL and Betriebsrat before approval", () => {
    let p = review(inReview(), "PDL", "APPROVED");
    expect(p.status).toBe("IN_REVIEW");
    expect(() => publish(p)).toThrow(TransitionError);
    p = review(p, "BETRIEBSRAT", "APPROVED");
    expect(p.status).toBe("APPROVED");
    expect(publish(p).status).toBe("PUBLISHED");
  });

  it("works in either order (parallel)", () => {
    const p = review(review(inReview(), "BETRIEBSRAT", "APPROVED"), "PDL", "APPROVED");
    expect(p.status).toBe("APPROVED");
  });

  it("a single rejection sends the plan back, even after the other approved", () => {
    const p = review(review(inReview(), "PDL", "APPROVED"), "BETRIEBSRAT", "REJECTED");
    expect(p.status).toBe("CHANGES_REQUESTED");
    expect(() => publish(p)).toThrow(TransitionError);
  });

  it("resubmitting resets decisions", () => {
    const p = submit(review(inReview(), "PDL", "REJECTED"));
    expect(p.status).toBe("IN_REVIEW");
    expect(p.decisions).toEqual({ PDL: "PENDING", BETRIEBSRAT: "PENDING" });
  });

  it("rejects double votes and reviews outside review", () => {
    const p = review(inReview(), "PDL", "APPROVED");
    expect(() => review(p, "PDL", "APPROVED")).toThrow(TransitionError);
    expect(() => review(newPlan(), "PDL", "APPROVED")).toThrow(TransitionError);
  });

  it("editing a published plan creates a new version needing fresh approval", () => {
    const published = publish(review(review(inReview(), "PDL", "APPROVED"), "BETRIEBSRAT", "APPROVED"));
    const edited = edit(published);
    expect(edited).toMatchObject({ status: "DRAFT", version: 2 });
    expect(() => publish(edited)).toThrow(TransitionError);
  });

  it("cannot submit twice", () => {
    expect(() => submit(inReview())).toThrow(TransitionError);
  });
});
