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

export const TERMINAL_GOAL_STATES: ReadonlySet<GoalState> = new Set([
  "stopped",
  "succeeded",
  "failed",
]);

export function isTerminalGoalState(state: GoalState): boolean {
  return TERMINAL_GOAL_STATES.has(state);
}

export class InvalidGoalTransitionError extends Error {
  readonly from: GoalState;
  readonly to: GoalState;

  constructor(from: GoalState, to: GoalState) {
    super(`Invalid Goal transition: ${from} -> ${to}`);
    this.name = "InvalidGoalTransitionError";
    this.from = from;
    this.to = to;
  }
}

const allowedTransitions: Readonly<Record<GoalState, readonly GoalState[]>> = {
  draft: ["ready_for_confirmation", "recovering"],
  ready_for_confirmation: ["draft", "launched", "recovering"],
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
    throw new InvalidGoalTransitionError(from, to);
  }
  return to;
}
