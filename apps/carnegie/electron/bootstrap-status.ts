import type { LocalBootstrapStepEvent } from "@maestro/local-backend";
import { redactBridgeText } from "./api-error-bridge.js";

export type BootstrapStatus =
  | { phase: "starting"; step?: LocalBootstrapStepEvent }
  | { phase: "ready" }
  | { phase: "setup-required"; reason?: string; canRetryLocal?: boolean };

export function sanitizeBootstrapStatus(status: BootstrapStatus): BootstrapStatus {
  if (status.phase === "setup-required" && status.reason !== undefined) {
    return { ...status, reason: redactBridgeText(status.reason) };
  }
  if (status.phase === "starting" && status.step?.message !== undefined) {
    return { ...status, step: { ...status.step, message: redactBridgeText(status.step.message) } };
  }
  return status;
}
