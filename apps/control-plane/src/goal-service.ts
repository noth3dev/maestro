import type { GoalResult, CreateGoalInput, TransitionGoalInput, GoalControlInput } from "@maestro/contracts";
import {
  acquireGoalLease,
  renewGoalLease,
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
  const leaseProofs = new Map<string, import("@maestro/persistence").GoalLeaseProof>();

  async function leaseFor(goalId: string): Promise<import("@maestro/persistence").GoalLeaseProof> {
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
    try {
      const proof = await leaseFor(goalId);
      const result = await executeGoalCommand(options.pool, command, proof);
      const goalResult = commandResult(result, command.projectId);
      // Keep the proof after terminal writes. A client may lose the response
      // after commit and retry the same idempotency key; receipt replay still
      // requires the current lease proof. The proof is replaced on expiry or
      // fencing, and terminal Goals cannot accept a different command.
      return goalResult;
    } catch (error) {
      if (error instanceof PersistenceStaleGoalLeaseError) leaseProofs.delete(goalId);
      if (error instanceof GoalServiceError) throw error;
      if (error instanceof PersistenceCommandIdReuseError) throw new CommandIdReuseError();
      if (error instanceof PersistenceLeaseUnavailableError) throw new LeaseUnavailableError();
      if (error instanceof PersistenceStaleGoalLeaseError) throw new StaleLeaseError();
      throw new DurableStoreUnavailableError();
    }
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
      return execute(commandId, { commandId, projectId: input.projectId, goalId: commandId, actorId: operator.operatorId, type: "CreateGoal", expectedVersion: 0, requiredRole: "concertmaster", ...(input.contractId === undefined ? {} : { contractId: input.contractId }) });
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
      let proof = await leaseFor(goalId);
      const renew = async () => {
        proof = await renewGoalLease(options.pool, proof, leaseDurationMs);
        leaseProofs.set(goalId, proof);
        return proof;
      };
      return operation(proof, renew);
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
