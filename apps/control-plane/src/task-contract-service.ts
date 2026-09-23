import { randomUUID } from "node:crypto";
import type {
  CreateTaskContractInput,
  OvertureSelectionInput,
  TaskContract,
  TaskContractConfirmationInput,
  TaskContractLaunchResult,
  UpdateTaskContractInput,
} from "@maestro/contracts";
import {
  createDurableTaskContract,
  ExactConfirmationRequiredError,
  launchConfirmedTaskContract,
  executeCreateGoalCommandInTransaction,
  markOvertureRunLaunchedForTaskContractInTransaction,
  readTaskContract,
  recordExactTaskContractConfirmation,
  selectAndRecordOvertureRoles,
  TaskContractConflictError,
  TaskContractIntegrityError,
  TaskContractNotFoundError,
  TaskContractProjectBoundaryError,
  TaskContractVersionConflictError,
  updateDurableTaskContract,
  assertProjectRole,
  type OperatorContext,
} from "@maestro/persistence";
import type { Pool } from "pg";

export interface TaskContractService {
  createTaskContract(contractId: string, input: CreateTaskContractInput, operator: OperatorContext): Promise<TaskContract>;
  getTaskContract(contractId: string, projectId: string): Promise<TaskContract>;
  updateTaskContract(
    contractId: string,
    input: UpdateTaskContractInput,
    operator: OperatorContext,
    commandId?: string,
  ): Promise<TaskContract>;
  selectOvertureRoles(
    contractId: string,
    input: OvertureSelectionInput,
    commandId: string | undefined,
    operator: OperatorContext,
  ): Promise<readonly string[]>;
  confirmTaskContract(
    contractId: string,
    input: TaskContractConfirmationInput,
    operator: OperatorContext,
    commandId?: string,
  ): Promise<void>;
  launchTaskContract(contractId: string, projectId: string, operator: OperatorContext, commandId?: string): Promise<TaskContractLaunchResult>;
}

export class TaskContractProjectMismatchError extends Error {}
export class TaskContractOrchestrationUnavailableError extends Error {}

type GoalOrchestrationService = {
  withGoalLease?<T>(
    goalId: string,
    operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>,
  ): Promise<T>;
  releaseGoalLease?(goalId: string): Promise<void>;
};

export function createDurableTaskContractService(pool: Pool, goalService?: GoalOrchestrationService): TaskContractService {
  async function readForProject(contractId: string, projectId: string): Promise<TaskContract> {
    const contract = await readTaskContract(pool, contractId);
    // Do not disclose whether a contract exists in another project.
    if (!contract || contract.project.projectId !== projectId)
      throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
    return contract;
  }

  async function readAuthorityDefaults(operatorId: string): Promise<{ spendCeilingCents: number; criticalActionsRequireApproval: boolean; allowFlashmob: boolean }> {
    const defaults = { spendCeilingCents: 5000, criticalActionsRequireApproval: true, allowFlashmob: true };
    try {
      const result = await pool.query<{ spend_ceiling_cents: string; critical_actions_require_approval: boolean; allow_flashmob: boolean }>(
        "SELECT spend_ceiling_cents, critical_actions_require_approval, allow_flashmob FROM operator_settings WHERE operator_id = $1",
        [operatorId],
      );
      if (result.rowCount !== 1) return defaults;
      return {
        spendCeilingCents: Number(result.rows[0]!.spend_ceiling_cents),
        criticalActionsRequireApproval: result.rows[0]!.critical_actions_require_approval,
        allowFlashmob: result.rows[0]!.allow_flashmob,
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "42P01") return defaults;
      throw error;
    }
  }

  async function assertLaunchConfirmation(contract: TaskContract): Promise<void> {
    if (contract.launchState === "launched") return;
    const confirmation = await pool.query(
      "SELECT 1 FROM task_contract_confirmations WHERE contract_id = $1 AND contract_version = $2 AND content_hash = $3",
      [contract.contractId, contract.version, contract.contentHash],
    );
    if (confirmation.rowCount !== 1) throw new ExactConfirmationRequiredError("Exact current Task Contract confirmation is required before launch");
  }

  async function readBoundGoal(contractId: string, projectId: string): Promise<string | undefined> {
    const result = await pool.query<{ goal_id: string; project_id: string }>(
      "SELECT goal_id, project_id FROM goals WHERE task_contract_id = $1",
      [contractId],
    );
    if (result.rowCount === 0) return undefined;
    if (result.rows[0]!.project_id !== projectId) throw new TaskContractProjectBoundaryError("Task Contract Goal project boundary mismatch");
    return result.rows[0]!.goal_id;
  }

  return {
    async createTaskContract(contractId, input, operator) {
      await assertProjectRole(pool, operator.operatorId, input.projectId, "concertmaster");
      assertProjectBoundary(input.projectId, input.substance.project.projectId);
      return createDurableTaskContract(pool, contractId, input.substance);
    },
    async getTaskContract(contractId, projectId) {
      return readForProject(contractId, projectId);
    },
    async updateTaskContract(contractId, input, operator, commandId) {
      await assertProjectRole(pool, operator.operatorId, input.projectId, "concertmaster");
      const current = await readForProject(contractId, input.projectId);
      assertProjectBoundary(input.projectId, input.substance.project.projectId);
      if (current.project.projectId !== input.substance.project.projectId)
        throw new TaskContractProjectMismatchError("Task Contract project boundary cannot change");
      return updateDurableTaskContract(
        pool,
        contractId,
        input.expectedVersion,
        input.substance,
        { ...input.evidence, actorId: operator.operatorId },
        commandId,
      );
    },
    async selectOvertureRoles(contractId, input, commandId, operator) {
      await assertProjectRole(pool, operator.operatorId, input.projectId, "concertmaster");
      await readForProject(contractId, input.projectId);
      return selectAndRecordOvertureRoles(pool, contractId, input, commandId);
    },
    async confirmTaskContract(contractId, input, operator, commandId) {
      await assertProjectRole(pool, operator.operatorId, input.projectId, "concertmaster");
      await readForProject(contractId, input.projectId);
      await recordExactTaskContractConfirmation(pool, contractId, input.version, input.contentHash, operator.operatorId, commandId);
    },
    async launchTaskContract(contractId, projectId, operator, commandId = contractId) {
      await assertProjectRole(pool, operator.operatorId, projectId, "concertmaster");
      const contract = await readForProject(contractId, projectId);
      await assertLaunchConfirmation(contract);
      let goalId = await readBoundGoal(contractId, projectId);

      if (goalId !== undefined) {
        const launched = await launchConfirmedTaskContract(pool, contractId, async (client) => {
          await assertProjectRole(client, operator.operatorId, projectId, "concertmaster");
          // Overture events use their own command namespace. Reusing the
          // Launch id would collide with task_contract_attached when the
          // default launch id is the contract id.
          await markOvertureRunLaunchedForTaskContractInTransaction(client, contractId, randomUUID(), projectId);
        });
        return { taskContract: launched, goalId, scheduling: "queued" };
      }

      if (goalService?.withGoalLease === undefined) throw new TaskContractOrchestrationUnavailableError("Task Contract launch orchestration is not configured");
      const proposedGoalId = randomUUID();
      const authorityDefaults = await readAuthorityDefaults(operator.operatorId);
      let attachedGoalId: string | undefined;
      let launched: TaskContract;
      try {
        launched = await goalService.withGoalLease(proposedGoalId, async (proof) => launchConfirmedTaskContract(pool, contractId, async (client) => {
          const bound = await client.query<{ goal_id: string; project_id: string }>(
            "SELECT goal_id, project_id FROM goals WHERE task_contract_id = $1 FOR UPDATE",
            [contractId],
          );
          if (bound.rowCount === 1) {
            if (bound.rows[0]!.project_id !== projectId) throw new TaskContractProjectBoundaryError("Task Contract Goal project boundary mismatch");
            attachedGoalId = bound.rows[0]!.goal_id;
          } else {
            const created = await executeCreateGoalCommandInTransaction(client, {
              commandId,
              projectId,
              goalId: proposedGoalId,
              actorId: operator.operatorId,
              type: "CreateGoal",
              expectedVersion: 0,
              contractId,
              requiredRole: "concertmaster",
              authorityDefaults,
            }, proof);
            if (created.outcome !== "succeeded") throw new TaskContractOrchestrationUnavailableError(`Task Contract Goal creation did not succeed: ${created.code ?? created.outcome}`);
            attachedGoalId = proposedGoalId;
          }
          await markOvertureRunLaunchedForTaskContractInTransaction(client, contractId, randomUUID(), projectId);
        }));
      } catch (error) {
        await goalService.releaseGoalLease?.(proposedGoalId);
        throw error;
      }
      goalId = attachedGoalId;
      if (goalId === undefined) throw new TaskContractOrchestrationUnavailableError("Task Contract launch did not attach a Goal");
      if (goalId !== proposedGoalId) await goalService.releaseGoalLease?.(proposedGoalId);
      return { taskContract: launched, goalId, scheduling: "queued" };
    },
  };
}

function assertProjectBoundary(requestedProjectId: string, contentProjectId: string): void {
  if (requestedProjectId !== contentProjectId)
    throw new TaskContractProjectMismatchError("Task Contract project binding does not match its content");
}

export {
  ExactConfirmationRequiredError,
  TaskContractConflictError,
  TaskContractIntegrityError,
  TaskContractNotFoundError,
  TaskContractProjectBoundaryError,
  TaskContractVersionConflictError,
};
