import type {
  CreateTaskContractInput,
  OvertureSelectionInput,
  TaskContract,
  TaskContractConfirmationInput,
  TaskContractQuery,
  UpdateTaskContractInput,
} from "@maestro/contracts";
import {
  createDurableTaskContract,
  ExactConfirmationRequiredError,
  launchConfirmedTaskContract,
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
  updateTaskContract(contractId: string, input: UpdateTaskContractInput, operator: OperatorContext, commandId?: string): Promise<TaskContract>;
  selectOvertureRoles(contractId: string, input: OvertureSelectionInput, commandId: string | undefined, operator: OperatorContext): Promise<readonly string[]>;
  confirmTaskContract(contractId: string, input: TaskContractConfirmationInput, operator: OperatorContext, commandId?: string): Promise<void>;
  launchTaskContract(contractId: string, projectId: string, operator: OperatorContext, commandId?: string): Promise<TaskContract>;
}

export class TaskContractProjectMismatchError extends Error {}

export function createDurableTaskContractService(pool: Pool): TaskContractService {
  async function readForProject(contractId: string, projectId: string): Promise<TaskContract> {
    const contract = await readTaskContract(pool, contractId);
    // Do not disclose whether a contract exists in another project.
    if (!contract || contract.project.projectId !== projectId) throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
    return contract;
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
      if (current.project.projectId !== input.substance.project.projectId) throw new TaskContractProjectMismatchError("Task Contract project boundary cannot change");
      return updateDurableTaskContract(pool, contractId, input.expectedVersion, input.substance, { ...input.evidence, actorId: operator.operatorId }, commandId);
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
    async launchTaskContract(contractId, projectId, operator, _commandId) {
      await assertProjectRole(pool, operator.operatorId, projectId, "concertmaster");
      await readForProject(contractId, projectId);
      return launchConfirmedTaskContract(pool, contractId);
    },
  };
}

function assertProjectBoundary(requestedProjectId: string, contentProjectId: string): void {
  if (requestedProjectId !== contentProjectId) throw new TaskContractProjectMismatchError("Task Contract project binding does not match its content");
}

export {
  ExactConfirmationRequiredError,
  TaskContractConflictError,
  TaskContractIntegrityError,
  TaskContractNotFoundError,
  TaskContractProjectBoundaryError,
  TaskContractVersionConflictError,
};
