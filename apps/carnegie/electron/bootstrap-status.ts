import type { LocalBootstrapStepEvent } from "@maestro/local-backend";
import { boundBootstrapMessage } from "../src/lib/bootstrap-error-message.js";
import { redactBridgeText } from "./api-error-bridge.js";

export type BootstrapStatus =
  | { phase: "starting"; step?: LocalBootstrapStepEvent }
  | { phase: "ready" }
  | { phase: "setup-required"; reason?: string; canRetryLocal?: boolean };

export function sanitizeBootstrapMessage(message: string): string {
  return boundBootstrapMessage(redactBridgeText(message));
}

export function sanitizeBootstrapStatus(status: BootstrapStatus): BootstrapStatus {
  if (status.phase === "setup-required" && status.reason !== undefined) {
    return { ...status, reason: sanitizeBootstrapMessage(status.reason) };
  }
  if (status.phase === "starting" && status.step?.message !== undefined) {
    return { ...status, step: { ...status.step, message: sanitizeBootstrapMessage(status.step.message) } };
  }
  return status;
}
