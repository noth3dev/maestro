import { describe, expect, it } from "vitest";
import type { OvertureEvent } from "@maestro/contracts";
import { evaluateReviewGate, reviewBlockers } from "./review-gate.js";

function write(path: string, roleId: string): OvertureEvent {
  return { eventType: "tool_activity", payload: { kind: "write_file", status: "ok", path, roleId } } as unknown as OvertureEvent;
}

const clean = "# Review\n\n## Blockers\nNone\n\n## Suggestions\n- tighten copy\n";

describe("plan review gate", () => {
  it("passes when the Plan Reviewer reviewed the latest plan with no blockers", () => {
    const events = [write("prd.md", "task-editor"), write("reviews/plan.md", "plan-reviewer")];
    expect(evaluateReviewGate({ events, review: clean })).toEqual({ state: "passed", reviewer: "plan-reviewer" });
  });

  it("requires a review written by the Plan Reviewer", () => {
    expect(evaluateReviewGate({ events: [write("prd.md", "task-editor")], review: undefined }).state).toBe("missing");
    expect(evaluateReviewGate({ events: [write("reviews/plan.md", "conversation-lead")], review: clean }).state).toBe("missing");
  });

  it("goes stale when the plan changes after the review", () => {
    const events = [write("reviews/plan.md", "plan-reviewer"), write("prd.md", "task-editor")];
    expect(evaluateReviewGate({ events, review: clean })).toMatchObject({ state: "stale" });
  });

  it("refuses self-review and reports blockers", () => {
    expect(evaluateReviewGate({ events: [write("prd.md", "plan-reviewer"), write("reviews/plan.md", "plan-reviewer")], review: clean }).state).toBe("self_review");
    const blocked = evaluateReviewGate({ events: [write("reviews/plan.md", "plan-reviewer")], review: "## Blockers\n- No success criterion is measurable\n- Scope includes payments\n" });
    expect(blocked).toMatchObject({ state: "blocked", blockers: ["No success criterion is measurable", "Scope includes payments"] });
  });

  it("reads blockers only from the Blockers section", () => {
    expect(reviewBlockers("## Blockers\n\n- None.\n\n## Suggestions\n- x")).toEqual([]);
    expect(reviewBlockers("## Blockers\n없음\n")).toEqual([]);
    expect(reviewBlockers("## Suggestions\n- x")).toEqual(["The review has no ## Blockers section"]);
  });
});
