import type { GoalEvent } from "@maestro/api-client";
import type { ApprovalDialogSummary } from "./confirmation.js";
import { pendingDecisionsFromActivity, toActivityTimelineEvent } from "./components/activity-timeline.js";
import type { PendingDecision } from "./components/shell.js";

export interface PendingConfirmationState {
  summary: ApprovalDialogSummary;
}

export interface PendingDecisionProjectionOptions {
  goalId: string | undefined;
  activity: readonly GoalEvent[];
  pendingConfirmation?: PendingConfirmationState;
}

export function pendingDecisionsForView(options: PendingDecisionProjectionOptions): PendingDecision[] {
  const scopedActivity =
    options.goalId === undefined ? [] : options.activity.filter((event) => event.goalId === options.goalId).map(toActivityTimelineEvent);
  const decisions = pendingDecisionsFromActivity(scopedActivity);
  const summary = options.pendingConfirmation?.summary;
  if (summary !== undefined) {
    const identity = summary.identity?.trim();
    const actor = summary.actor?.trim();
    const tier = summary.tier === "user" ? "You" : summary.tier;
    if (identity !== undefined && identity !== "" && actor !== undefined && actor !== "" && tier !== undefined) {
      decisions.unshift({ identity, tier, action: `${summary.action} ${summary.target}`, actor });
    }
  }
  return decisions;
}
