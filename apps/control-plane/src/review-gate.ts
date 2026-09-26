import type { OvertureEvent } from "@maestro/contracts";

export const PLAN_REVIEW_PATH = "reviews/plan.md";
const REVIEWER = "plan-reviewer";

export type ReviewGate =
  | { readonly state: "passed"; readonly reviewer: string }
  | { readonly state: "missing" | "stale" | "self_review"; readonly reason: string }
  | { readonly state: "blocked"; readonly blockers: readonly string[]; readonly reason: string };

type Write = { readonly path: string; readonly roleId: string; readonly order: number };

/** Successful crew file writes in event order, from tool_activity events. */
function writes(events: readonly OvertureEvent[]): Write[] {
  return events.flatMap((event, order) => {
    if (event.eventType !== "tool_activity") return [];
    const payload = event.payload as { kind?: unknown; status?: unknown; path?: unknown; roleId?: unknown };
    if (payload.kind !== "write_file" || payload.status !== "ok" || typeof payload.path !== "string" || typeof payload.roleId !== "string") return [];
    return [{ path: payload.path, roleId: payload.roleId, order }];
  });
}

/** Blocker bullets from the review's `## Blockers` section; "None" means no blockers. */
export function reviewBlockers(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+blockers\b/i.test(line.trim()));
  if (start < 0) return ["The review has no ## Blockers section"];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line.trim())) break;
    body.push(line);
  }
  const items = body
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter((line) => line !== "" && !/^(none|no blockers|없음|n\/a)\.?$/i.test(line));
  return items;
}

/**
 * The plan must be reviewed by the Plan Reviewer, after its latest change,
 * without open blockers, and prd.md must not have been written by the
 * reviewer itself — authors never pass their own work.
 */
export function evaluateReviewGate(input: { readonly events: readonly OvertureEvent[]; readonly review: string | undefined }): ReviewGate {
  const all = writes(input.events);
  const latest = (predicate: (write: Write) => boolean) => [...all].reverse().find(predicate);
  const review = latest((write) => write.path === PLAN_REVIEW_PATH);
  if (input.review === undefined || review === undefined)
    return { state: "missing", reason: `Ask @review to review prd.md; ${PLAN_REVIEW_PATH} has not been written by the crew yet` };
  if (review.roleId !== REVIEWER)
    return { state: "missing", reason: `${PLAN_REVIEW_PATH} was last written by ${review.roleId}, not the Plan Reviewer` };
  const prd = latest((write) => write.path === "prd.md");
  if (prd?.roleId === REVIEWER) return { state: "self_review", reason: "prd.md was written by the Plan Reviewer, who may not review its own work" };
  const planChange = latest((write) => write.path === "prd.md");
  if (planChange !== undefined && planChange.order > review.order)
    return { state: "stale", reason: `${planChange.path} changed after the last review; ask @review to review it again` };
  const blockers = reviewBlockers(input.review);
  if (blockers.length > 0) return { state: "blocked", blockers, reason: `The Plan Reviewer reported ${blockers.length} blocker(s)` };
  return { state: "passed", reviewer: REVIEWER };
}
