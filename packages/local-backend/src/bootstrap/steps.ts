import type { LocalBootstrapStepEvent, LocalBootstrapStepName, LocalBootstrapStepStatus } from "./types.js";

export function reportSetupStep(
  onStep: ((event: LocalBootstrapStepEvent) => void) | undefined,
  step: LocalBootstrapStepName,
  status: LocalBootstrapStepStatus,
  message?: string,
): void {
  try {
    onStep?.({ step, status, ...(message === undefined ? {} : { message }) });
  } catch {
    // Setup telemetry is presentation-only and must never change bootstrap behavior.
  }
}
