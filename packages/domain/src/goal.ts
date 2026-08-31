export type GoalState =
  | "draft"
  | "ready_for_confirmation"
  | "launched"
  | "active"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping"
  | "stopped"
  | "blocked"
  | "certifying"
  | "succeeded"
  | "failed"
  | "recovering";

const allowedTransitions: Readonly<Record<GoalState, readonly GoalState[]>> = {
  draft: ["ready_for_confirmation"],
  ready_for_confirmation: ["draft", "launched"],
  launched: ["active", "recovering"],
  active: ["pausing", "stopping", "blocked", "certifying", "recovering"],
  pausing: ["paused", "blocked", "recovering"],
  paused: ["resuming", "stopping", "blocked", "recovering"],
  resuming: ["active", "blocked", "recovering"],
  stopping: ["stopped", "blocked", "recovering"],
  stopped: [],
  blocked: ["active", "stopped", "recovering"],
  certifying: ["succeeded", "failed", "blocked", "recovering"],
  succeeded: [],
  failed: [],
  recovering: ["active", "paused", "blocked", "stopped"],
};

export function transitionGoal(from: GoalState, to: GoalState): GoalState {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid Goal transition: ${from} -> ${to}`);
  }
  return to;
}
