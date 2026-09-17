import {
  CreateDepartmentPlanInputSchema,
  DepartmentPlanSchema,
  ReviseDepartmentPlanInputSchema,
  CreateMissionBundleInputSchema,
  MissionBundleSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createPlanningMethods(
  ctx: MethodContext,
): Pick<ApiClient, "createDepartmentPlan" | "getDepartmentPlan" | "reviseDepartmentPlan" | "createMissionBundle" | "getMissionBundle"> {
  const { request, headers } = ctx;
  return {
    createDepartmentPlan(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/plan`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CreateDepartmentPlanInputSchema.parse(input)),
        },
        DepartmentPlanSchema,
      );
    },
    getDepartmentPlan(councilId, departmentId, projectId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/plan?${new URLSearchParams({ projectId: UuidSchema.parse(projectId) })}`,
        { headers },
        DepartmentPlanSchema,
      );
    },
    reviseDepartmentPlan(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/plan`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(ReviseDepartmentPlanInputSchema.parse(input)),
        },
        DepartmentPlanSchema,
      );
    },
    createMissionBundle(councilId, departmentId, itemId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId) || !/^[A-Za-z0-9._:-]+$/.test(itemId)) throw new Error("Invalid mission bundle identity");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/mission-bundles/${encodeURIComponent(itemId)}`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CreateMissionBundleInputSchema.parse(input)),
        },
        MissionBundleSchema,
      );
    },
    getMissionBundle(councilId, departmentId, planVersion, itemId, projectId) {
      if (
        !/^[A-Za-z0-9:_-]+$/.test(departmentId) ||
        !/^[A-Za-z0-9._:-]+$/.test(itemId) ||
        !Number.isSafeInteger(planVersion) ||
        planVersion < 1
      )
        throw new Error("Invalid mission bundle identity");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/mission-bundles/${encodeURIComponent(itemId)}?${new URLSearchParams({ projectId: UuidSchema.parse(projectId), planVersion: String(planVersion) })}`,
        { headers },
        MissionBundleSchema,
      );
    },
  };
}
