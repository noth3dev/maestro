import type { Pool } from "pg";
import {
  claimStartGoalOutbox,
  GoalOrchestrationBindingError,
  GoalOrchestrationEnvelopeError,
  markGoalOutboxDelivered,
  releaseGoalOutbox,
  validateStartGoalOrchestrationCommand,
  type GoalOutboxMessage,
  type ValidatedStartGoalOrchestrationCommand,
} from "@maestro/persistence";

export interface StartGoalOutboxLoopScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemScheduler: StartGoalOutboxLoopScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

type StartGoalOutboxOutcome =
  "delivered" | "running" | "completed" | "blocked" | "unknown" | "invalid_envelope" | "invalid_binding" | "retry" | "error";

type StartGoalOutboxTick = {
  outboxId: string;
  eventId: string;
  outcome: StartGoalOutboxOutcome;
  error?: unknown;
};

export interface StartGoalOutboxLoopDependencies {
  pool: Pool;
  ownerId: string;
  intervalMs: number;
  limit?: number;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  scheduler?: StartGoalOutboxLoopScheduler;
  claim?: typeof claimStartGoalOutbox;
  validate?: typeof validateStartGoalOrchestrationCommand;
  execute?: (command: ValidatedStartGoalOrchestrationCommand) => Promise<{ state: "running" | "blocked" | "unknown" | "completed" }>;
  markDelivered?: typeof markGoalOutboxDelivered;
  release?: typeof releaseGoalOutbox;
  onTick?: (result: StartGoalOutboxTick | { outcome: "claim_error"; error: unknown }) => void;
}

export interface StartGoalOutboxLoop {
  start(): void;
  stop(): void;
  runOnce(): Promise<void>;
}

/**
 * Drains the first durable start_goal handoff. Validation failures are terminal
 * poison messages; transient persistence failures are released for bounded retry.
 * When configured with execute, the loop may create the bounded Head-stage/provider
 * effect before acknowledging the outbox row; it does not advance Council or later stages.
 */
export function createStartGoalOutboxLoop(deps: StartGoalOutboxLoopDependencies): StartGoalOutboxLoop {
  const scheduler = deps.scheduler ?? systemScheduler;
  const claim = deps.claim ?? claimStartGoalOutbox;
  const validate = deps.validate ?? validateStartGoalOrchestrationCommand;
  const markDelivered = deps.markDelivered ?? markGoalOutboxDelivered;
  const release = deps.release ?? releaseGoalOutbox;
  let handle: unknown;
  let running = false;

  function report(message: GoalOutboxMessage, outcome: StartGoalOutboxOutcome, error?: unknown): void {
    deps.onTick?.({ outboxId: message.outboxId, eventId: message.eventId, outcome, ...(error === undefined ? {} : { error }) });
  }

  async function markPoison(message: GoalOutboxMessage, outcome: "invalid_envelope" | "invalid_binding"): Promise<void> {
    try {
      await markDelivered(deps.pool, message.outboxId, deps.ownerId);
      report(message, outcome);
    } catch (error) {
      report(message, "error", error);
    }
  }

  async function processOne(message: GoalOutboxMessage): Promise<void> {
    let validated: ValidatedStartGoalOrchestrationCommand;
    try {
      validated = await validate(deps.pool, message);
    } catch (error) {
      if (error instanceof GoalOrchestrationEnvelopeError) return markPoison(message, "invalid_envelope");
      if (error instanceof GoalOrchestrationBindingError) return markPoison(message, "invalid_binding");
      try {
        await release(deps.pool, message.outboxId, deps.ownerId, deps.retryDelayMs);
        report(message, "retry", error);
      } catch (releaseError) {
        report(message, "error", releaseError);
      }
      return;
    }
    try {
      const outcome = deps.execute === undefined ? undefined : await deps.execute(validated);
      await markDelivered(deps.pool, message.outboxId, deps.ownerId);
      report(message, outcome?.state ?? "delivered");
    } catch (error) {
      try {
        await release(deps.pool, message.outboxId, deps.ownerId, deps.retryDelayMs);
        report(message, "retry", error);
      } catch (releaseError) {
        report(message, "error", releaseError);
      }
    }
  }

  async function runOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      let claimed: GoalOutboxMessage[];
      try {
        claimed = await claim(deps.pool, deps.ownerId, deps.limit, deps.leaseDurationMs);
      } catch (error) {
        deps.onTick?.({ outcome: "claim_error", error });
        return;
      }
      for (const message of claimed) await processOne(message);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (handle !== undefined) return;
      handle = scheduler.setInterval(() => {
        void runOnce();
      }, deps.intervalMs);
    },
    stop() {
      if (handle === undefined) return;
      scheduler.clearInterval(handle);
      handle = undefined;
    },
    runOnce,
  };
}
