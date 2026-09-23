import type { GoalResult, CreateGoalInput, TransitionGoalInput, GoalControlInput } from "@maestro/contracts";
import { isTerminalGoalState, type GoalState } from "@maestro/domain";
import {
  acquireGoalLease,
  renewGoalLease,
  releaseGoalLease,
  executeGoalCommand,
  CommandIdReuseError as PersistenceCommandIdReuseError,
  LeaseUnavailableError as PersistenceLeaseUnavailableError,
  StaleGoalLeaseError as PersistenceStaleGoalLeaseError,
  type CommandResult,
  type GoalCommand,
} from "@maestro/persistence";
import type { Pool } from "pg";
import type { OperatorContext } from "@maestro/persistence";

export type { GoalControlInput };

export interface GoalService {
  createGoal(input: CreateGoalInput, commandId: string, operator: OperatorContext): Promise<GoalResult>;
  transitionGoal(goalId: string, input: TransitionGoalInput, commandId: string, operator: OperatorContext): Promise<GoalResult>;
  /** Narrow lifecycle commands. Each command is independently idempotent by commandId. */
  pauseGoal(goalId: string, input: GoalControlInput, commandId: string, operator: OperatorContext): Promise<GoalResult>;
  stopGoal(goalId: string, input: GoalControlInput, commandId: string, operator: OperatorContext): Promise<GoalResult>;
  resumeGoal(goalId: string, input: GoalControlInput, commandId: string, operator: OperatorContext): Promise<GoalResult>;
  emergencyStopGoal(goalId: string, input: GoalControlInput, commandId: string, operator: OperatorContext): Promise<GoalResult>;
  getGoal(goalId: string, projectId: string): Promise<GoalResult>;
  /** Internal composition seam for other authenticated lifecycle commands. */
  withGoalLease?<T>(
    goalId: string,
    operation: (
      proof: import("@maestro/persistence").GoalLeaseProof,
      renew?: () => Promise<import("@maestro/persistence").GoalLeaseProof>,
    ) => Promise<T>,
  ): Promise<T>;
  /** Release an internal lease when a pre-Goal orchestration transaction aborts. */
  releaseGoalLease?(goalId: string): Promise<void>;
}

export type GoalLeaseOperation = NonNullable<GoalService["withGoalLease"]>;

/**
 * Resolve the internal lease seam, failing closed when a composition built a
 * GoalService without it. Replaces non-null assertions at composition sites
 * with one explicit check so a miswired service fails at startup, not on
 * first use with an obscure TypeError.
 */
export function requireGoalLease(service: Pick<GoalService, "withGoalLease">): GoalLeaseOperation {
  if (service.withGoalLease === undefined) throw new DurableStoreUnavailableError();
  return service.withGoalLease;
}

class GoalServiceError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name; }
}
export class VersionConflictError extends GoalServiceError { constructor() { super("Goal version conflicts with the current version"); } }
export class InvalidTransitionError extends GoalServiceError { constructor() { super("Goal transition is not allowed"); } }
export class GoalNotFoundError extends GoalServiceError { constructor() { super("Goal was not found"); } }
export class StaleLeaseError extends GoalServiceError { constructor() { super("Goal lease is stale"); } }
export class LeaseUnavailableError extends GoalServiceError { constructor() { super("Goal lease is unavailable"); } }
export class CommandIdReuseError extends GoalServiceError { constructor() { super("Command ID was reused with a different request"); } }
export class DurableStoreUnavailableError extends GoalServiceError { constructor() { super("Durable store is unavailable"); } }
export class TaskContractNotFoundError extends GoalServiceError { constructor() { super("Task Contract was not found"); } }
export class TaskContractNotLaunchableError extends GoalServiceError { constructor() { super("Task Contract must be launched before Goal creation"); } }
export class TaskContractProjectMismatchError extends GoalServiceError { constructor() { super("Task Contract project does not match the Goal project"); } }
export class TaskContractIntegrityError extends GoalServiceError { constructor() { super("Task Contract integrity check failed"); } }

export interface DurableGoalServiceOptions {
  pool: Pool;
  /** Trusted configuration, never supplied by an HTTP request. */
  actorId: string;
  /** Unique control-plane instance identity, distinct from actorId. */
  leaseOwnerId: string;
  leaseDurationMs?: number;
}

export function createDurableGoalService(options: DurableGoalServiceOptions): GoalService {
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  type GoalLeaseProof = import("@maestro/persistence").GoalLeaseProof;
  const leaseProofs = new Map<string, GoalLeaseProof>();
  const goalQueues = new Map<string, Promise<unknown>>();

  async function inGoalQueue<T>(goalId: string, operation: () => Promise<T>): Promise<T> {
    const previous = goalQueues.get(goalId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    goalQueues.set(goalId, current);
    try {
      return await current;
    } finally {
      if (goalQueues.get(goalId) === current) goalQueues.delete(goalId);
    }
  }

  async function releaseCachedProof(goalId: string, proof: GoalLeaseProof): Promise<void> {
    if (leaseProofs.get(goalId) !== proof) return;
    try {
      await releaseGoalLease(options.pool, proof);
    } catch {
      // The command already committed. Evicting the proof still bounds memory
      // even when the durable lease is already stale or unavailable.
    }
    if (leaseProofs.get(goalId) === proof) leaseProofs.delete(goalId);
  }

  async function isDurablyTerminal(goalId: string): Promise<boolean> {
    try {
      const result = await options.pool.query<{ state: GoalState }>("SELECT state FROM goals WHERE goal_id = $1", [goalId]);
      return result.rowCount === 1 && isTerminalGoalState(result.rows[0]!.state);
    } catch {
      return false;
    }
  }

  async function leaseFor(goalId: string): Promise<GoalLeaseProof> {
    const currentProof = leaseProofs.get(goalId);
    if (currentProof) {
      try {
        const renewedProof = await renewGoalLease(options.pool, currentProof, leaseDurationMs);
        leaseProofs.set(goalId, renewedProof);
        return renewedProof;
      } catch (error) {
        if (!(error instanceof PersistenceStaleGoalLeaseError)) throw error;
        leaseProofs.delete(goalId);
      }
    }
    const acquiredProof = await acquireGoalLease(options.pool, { goalId, ownerId: options.leaseOwnerId, leaseDurationMs });
    leaseProofs.set(goalId, acquiredProof);
    return acquiredProof;
  }

  async function execute(goalId: string, command: GoalCommand): Promise<GoalResult> {
    return inGoalQueue(goalId, async () => {
      let proof: GoalLeaseProof | undefined;
      try {
        proof = await leaseFor(goalId);
        const result = await executeGoalCommand(options.pool, command, proof);
        const goalResult = commandResult(result, command.projectId);
        if (goalResult.state !== undefined && isTerminalGoalState(goalResult.state)) {
          // The durable command receipt is enough for a lost-response retry.
          // Serialize same-Goal work so release cannot invalidate a concurrent
          // retry or evict a replacement proof.
          await releaseCachedProof(goalId, proof);
        }
        return goalResult;
      } catch (error) {
        if (proof !== undefined && await isDurablyTerminal(goalId)) await releaseCachedProof(goalId, proof);
        if (error instanceof PersistenceStaleGoalLeaseError) leaseProofs.delete(goalId);
        if (error instanceof GoalServiceError) throw error;
        if (error instanceof PersistenceCommandIdReuseError) throw new CommandIdReuseError();
        if (error instanceof PersistenceLeaseUnavailableError) throw new LeaseUnavailableError();
        if (error instanceof PersistenceStaleGoalLeaseError) throw new StaleLeaseError();
        throw new DurableStoreUnavailableError();
      }
    });
  }

  async function transitionControl(
    goalId: string,
    input: GoalControlInput,
    commandId: string,
    operator: OperatorContext,
    to: TransitionGoalInput["to"],
  ): Promise<GoalResult> {
    return execute(goalId, {
      commandId,
      projectId: input.projectId,
      goalId,
      actorId: operator.operatorId,
      type: "TransitionGoal",
      expectedVersion: input.expectedVersion,
      requiredRole: "concertmaster",
      to,
    });
  }

  return {
    async createGoal(input, commandId, operator) {
      let authorityDefaults = { spendCeilingCents: 5000, criticalActionsRequireApproval: true, allowFlashmob: true };
      try {
        const result = await options.pool.query<{ spend_ceiling_cents: string; critical_actions_require_approval: boolean; allow_flashmob: boolean }>("SELECT spend_ceiling_cents, critical_actions_require_approval, allow_flashmob FROM operator_settings WHERE operator_id = $1", [operator.operatorId]);
        if (result.rowCount === 1) authorityDefaults = { spendCeilingCents: Number(result.rows[0]!.spend_ceiling_cents), criticalActionsRequireApproval: result.rows[0]!.critical_actions_require_approval, allowFlashmob: result.rows[0]!.allow_flashmob };
      } catch (error) {
        // A pre-0101 database may not have operator_settings yet. Only that
        // specific migration-era absence may use safe defaults; all other
        // durable read failures fail closed rather than creating an unbound Goal.
        if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "42P01")) throw error;
      }
      return execute(commandId, { commandId, projectId: input.projectId, goalId: commandId, actorId: operator.operatorId, type: "CreateGoal", expectedVersion: 0, requiredRole: "concertmaster", authorityDefaults, ...(input.contractId === undefined ? {} : { contractId: input.contractId }) });
    },
    async transitionGoal(goalId, input, commandId, operator) {
      return execute(goalId, { commandId, projectId: input.projectId, goalId, actorId: operator.operatorId, type: "TransitionGoal", expectedVersion: input.expectedVersion, requiredRole: "concertmaster", to: input.to });
    },
    async pauseGoal(goalId, input, commandId, operator) {
      return transitionControl(goalId, input, commandId, operator, "pausing");
    },
    async stopGoal(goalId, input, commandId, operator) {
      return transitionControl(goalId, input, commandId, operator, "stopping");
    },
    async resumeGoal(goalId, input, commandId, operator) {
      return transitionControl(goalId, input, commandId, operator, "resuming");
    },
    async emergencyStopGoal(goalId, input, commandId, operator) {
      return execute(goalId, {
        commandId,
        projectId: input.projectId,
        goalId,
        actorId: operator.operatorId,
        type: "EmergencyStopGoal",
        expectedVersion: input.expectedVersion,
        requiredRole: "concertmaster",
      });
    },
    async withGoalLease(goalId, operation) {
      return inGoalQueue(goalId, async () => {
        let proof = await leaseFor(goalId);
        const renew = async () => {
          proof = await renewGoalLease(options.pool, proof, leaseDurationMs);
          leaseProofs.set(goalId, proof);
          return proof;
        };
        return operation(proof, renew);
      });
    },
    async releaseGoalLease(goalId) {
      const proof = leaseProofs.get(goalId);
      if (proof !== undefined) await releaseCachedProof(goalId, proof);
    },
    async getGoal(goalId, projectId) {
      try {
        const result = await options.pool.query<{ goal_id: string; project_id: string; task_contract_id: string | null; state: GoalResult["state"]; version: string }>(
          "SELECT goal_id, project_id, task_contract_id, state, version FROM goals WHERE goal_id = $1 AND project_id = $2", [goalId, projectId],
        );
        if (result.rowCount !== 1) throw new GoalNotFoundError();
        const row = result.rows[0]!;
        return { goalId: row.goal_id, projectId: row.project_id, state: row.state, version: Number(row.version), ...(row.task_contract_id === null ? {} : { contractId: row.task_contract_id }) };
      } catch (error) {
        if (error instanceof GoalNotFoundError) throw error;
        throw new DurableStoreUnavailableError();
      }
    },
  };
}

function commandResult(result: CommandResult, projectId: string): GoalResult {
  if (result.outcome === "version_conflict") throw new VersionConflictError();
  if (result.code === "invalid_transition") throw new InvalidTransitionError();
  if (result.code === "goal_not_found") throw new GoalNotFoundError();
  if (result.code === "task_contract_not_found") throw new TaskContractNotFoundError();
  if (result.code === "task_contract_not_launched") throw new TaskContractNotLaunchableError();
  if (result.code === "task_contract_project_mismatch") throw new TaskContractProjectMismatchError();
  if (result.code === "task_contract_integrity_error") throw new TaskContractIntegrityError();
  if (result.outcome !== "succeeded" || result.version === undefined || result.state === undefined) {
    throw new DurableStoreUnavailableError();
  }
  return {
    goalId: result.goalId, projectId, state: result.state, version: result.version,
    ...(result.contractId === undefined ? {} : { contractId: result.contractId }),
  };
}
