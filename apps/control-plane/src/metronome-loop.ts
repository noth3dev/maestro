import type { Pool } from "pg";
import { isTerminalGoalState, METRONOME_ACTOR_ID, type ExecutionKernelPort, type GoalState } from "@maestro/domain";
import {
  observeGoalForMetronome,
  scanGoalForMetronomeFindings,
  expireAwaitingRepairWorkersForGoal,
  type GoalLeaseProof,
  type MetronomeActorContext,
  type MetronomeApprovalObservation,
  type MetronomeFindingRecord,
  type MetronomeGoalObservation,
} from "@maestro/persistence";

export interface MetronomeLoopScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemScheduler: MetronomeLoopScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface MetronomeLoopDependencies {
  pool: Pool;
  /** Optional native kernel used to release expired repair-hold sessions. */
  kernel?: ExecutionKernelPort;
  withGoalLease: <T>(goalId: string, operation: (proof: GoalLeaseProof) => Promise<T>) => Promise<T>;
  intervalMs: number;
  /** Drains durable queued capacity after terminal/recovery releases. */
  drainCapacityQueues?: () => Promise<void>;
  /** Capacity-only loop mode skips Goal observation while retaining queue draining. */
  scanGoals?: boolean;
  scheduler?: MetronomeLoopScheduler;
  /** Test-only injection point; production uses the complete durable observation pass. */
  observeGoal?: typeof observeGoalForMetronome;
  /** Test-only injection point for the legacy finding-only pass. */
  scanGoal?: typeof scanGoalForMetronomeFindings;
  /** Every per-Goal approval-ledger observation, never a write callback. */
  onApprovalObservation?: (goalId: string, observation: MetronomeApprovalObservation) => void;
  /** Every per-Goal scan outcome, whether it found something, was skipped, or errored. Never throws; observability only. */
  onTick?: (result: { goalId: string; outcome: "scanned" | "skipped" | "error"; findings?: readonly MetronomeFindingRecord[]; approvalObservation?: MetronomeGoalObservation["approvalObservation"]; challenges?: MetronomeGoalObservation["challenges"]; error?: unknown }) => void;
}

export interface MetronomeLoop {
  start(): void;
  stop(): void;
  /** Runs one full pass over every non-terminal Goal immediately, outside the interval schedule. Used by tests and manual operator triggers. */
  runOnce(): Promise<void>;
}

/**
 * Composes continuous Metronome observation: on a fixed interval, scans every currently
 * non-terminal Goal for durable findings, reusing the exact same `scanGoalForMetronomeFindings`
 * write path an operator-triggered `metronome scan` command already uses -- this loop is only a
 * scheduler around that existing, already-authorized call, not a second rule engine. A Goal whose
 * lease is contended (active work in progress) or whose control latch blocks scanning is skipped
 * for this tick, not treated as a loop failure; one Goal's error never stops the rest of the pass
 * or a future tick.
 */
export function createMetronomeLoop(deps: MetronomeLoopDependencies): MetronomeLoop {
  const scheduler = deps.scheduler ?? systemScheduler;
  const scanGoal = deps.scanGoal ?? scanGoalForMetronomeFindings;
  const observeGoal = deps.observeGoal ?? (deps.scanGoal === undefined ? observeGoalForMetronome : undefined);
  let handle: unknown;
  let running = false;

  async function scanOneGoal(goalId: string): Promise<void> {
    const context: MetronomeActorContext = { actorId: METRONOME_ACTOR_ID, sessionRef: `metronome-loop:${goalId}`, commandId: crypto.randomUUID() };
    try {
      if (deps.kernel !== undefined) await deps.withGoalLease(goalId, (proof) => expireAwaitingRepairWorkersForGoal(deps.pool, deps.kernel!, goalId, proof).then(() => undefined));
      const observation: MetronomeGoalObservation | undefined = observeGoal === undefined
        ? undefined
        : await deps.withGoalLease(goalId, (proof) => observeGoal(deps.pool, goalId, proof, context));
      const findings = observation === undefined
        ? await deps.withGoalLease(goalId, (proof) => scanGoal(deps.pool, goalId, proof, context))
        : observation.findings;
      if (observation !== undefined) deps.onApprovalObservation?.(goalId, observation.approvalObservation);
      deps.onTick?.({
        goalId,
        outcome: "scanned",
        findings,
        ...(observation === undefined ? {} : { approvalObservation: observation.approvalObservation, challenges: observation.challenges }),
      });
    } catch (error) {
      deps.onTick?.({ goalId, outcome: "error", error });
    }
  }

  async function runOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (deps.scanGoals !== false) {
        const nonTerminalStates: GoalState[] = ["draft", "ready_for_confirmation", "launched", "active", "pausing", "paused", "resuming", "stopping", "blocked", "certifying", "recovering"];
        const result = await deps.pool.query<{ goal_id: string; state: GoalState }>(
          "SELECT goal_id, state FROM goals WHERE state = ANY($1::text[]) ORDER BY created_at, goal_id",
          [nonTerminalStates],
        );
        for (const row of result.rows) {
          if (isTerminalGoalState(row.state)) continue;
          await scanOneGoal(row.goal_id);
        }
      }
      await deps.drainCapacityQueues?.();
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (handle !== undefined) return;
      handle = scheduler.setInterval(() => { void runOnce(); }, deps.intervalMs);
    },
    stop() {
      if (handle === undefined) return;
      scheduler.clearInterval(handle);
      handle = undefined;
    },
    runOnce,
  };
}
