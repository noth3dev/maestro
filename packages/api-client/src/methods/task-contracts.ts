import {
  CreateTaskContractInputSchema,
  TaskContractConfirmationInputSchema,
  TaskContractQuerySchema,
  TaskContractLaunchResultSchema,
  TaskContractSchema,
  UpdateTaskContractInputSchema,
  OvertureSelectionInputSchema,
  OvertureRoleSelectionResultSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createTaskContractsMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  "createTaskContract" | "getTaskContract" | "updateTaskContract" | "selectOvertureRoles" | "confirmTaskContract" | "launchTaskContract"
> {
  const { request, headers } = ctx;
  return {
    createTaskContract(input, contractId) {
      return request(
        "v1/task-contracts",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(contractId) },
          body: JSON.stringify(CreateTaskContractInputSchema.parse(input)),
        },
        TaskContractSchema,
      );
    },
    getTaskContract(contractId, query) {
      const parsedQuery = TaskContractQuerySchema.parse(query);
      return request(
        `v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`,
        { headers },
        TaskContractSchema,
      );
    },
    updateTaskContract(contractId, input, commandId = contractId) {
      return request(
        `v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(UpdateTaskContractInputSchema.parse(input)),
        },
        TaskContractSchema,
      );
    },
    selectOvertureRoles(contractId, input, commandId = contractId) {
      return request(
        `v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}/overture-selection`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(OvertureSelectionInputSchema.parse(input)),
        },
        OvertureRoleSelectionResultSchema,
      );
    },
    confirmTaskContract(contractId, input, commandId = contractId) {
      return request(
        `v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}/confirmation`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(TaskContractConfirmationInputSchema.parse(input)),
        },
        { parse: () => undefined },
      );
    },
    launchTaskContract(contractId, projectId, commandId = contractId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(
        `v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}/launch`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify({ projectId: parsedProjectId }),
        },
        TaskContractLaunchResultSchema,
      );
    },
  };
}
