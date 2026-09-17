import {
  CriticalActionInputSchema,
  CriticalActionApprovalInputSchema,
  CriticalActionResultSchema,
  CapabilitySessionSelectionInputSchema,
  CapabilitySessionSchema,
  EvidenceCaptureInputSchema,
  EvidenceRecordSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createEffectsMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  "requestCriticalAction" | "approveAndRunCriticalAction" | "denyCriticalAction" | "selectFullAccessMode" | "captureEvidence"
> {
  const { request, headers } = ctx;
  return {
    requestCriticalAction(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/critical-actions`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CriticalActionInputSchema.parse(input)),
        },
        CriticalActionResultSchema,
      );
    },
    approveAndRunCriticalAction(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/critical-actions/approve-and-run`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CriticalActionApprovalInputSchema.parse(input)),
        },
        CriticalActionResultSchema,
      );
    },
    denyCriticalAction(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/critical-actions/deny`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CriticalActionInputSchema.parse(input)),
        },
        { parse: () => undefined },
      );
    },
    selectFullAccessMode(goalId, input) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/capabilities/full-access-mode`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(CapabilitySessionSelectionInputSchema.parse(input)),
        },
        CapabilitySessionSchema,
      );
    },
    captureEvidence(goalId, input) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/evidence-records`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(EvidenceCaptureInputSchema.parse(input)),
        },
        EvidenceRecordSchema,
      );
    },
  };
}
