import type { BootstrapStatus } from "./global.js";
import { boundBootstrapMessage } from "./lib/bootstrap-error-message.js";
import { redactSensitiveText } from "./lib/command-id.js";

export { LONG_BOOTSTRAP_ERROR_SUMMARY, LOCAL_DATABASE_LOCK_SUMMARY } from "./lib/bootstrap-error-message.js";

const STEP_LABELS: Record<string, string> = {
  "docker-check": "checking Docker availability…",
  "postgres-ready": "starting the local database…",
  migrations: "running database migrations…",
  "control-plane-up": "starting the Control Plane…",
  "model-gateway-up": "starting the model gateway…",
};

const STEP_COMPLETED_LABELS: Record<string, string> = {
  "docker-check": "Docker is available.",
  "postgres-ready": "The local database is ready.",
  migrations: "Database migrations are complete.",
  "control-plane-up": "The Control Plane is ready.",
  "model-gateway-up": "The model gateway is ready.",
};

export function safeBootstrapErrorMessage(error: unknown, fallback = "Could not load the local workspace"): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return boundBootstrapMessage(redactSensitiveText(message));
}

export function sanitizeRendererBootstrapStatus(status: BootstrapStatus): BootstrapStatus {
  if (status.phase === "setup-required" && status.reason !== undefined) {
    return { ...status, reason: safeBootstrapErrorMessage(status.reason) };
  }
  if (status.phase === "starting" && status.step?.message !== undefined) {
    return { ...status, step: { ...status.step, message: safeBootstrapErrorMessage(status.step.message) } };
  }
  return status;
}

export function bootstrapProgressText(
  status: BootstrapStatus,
  fallback = "preparing the local Control Plane…",
  stepLabels: Readonly<Record<string, string>> = STEP_LABELS,
  completedStepLabels: Readonly<Record<string, string>> = STEP_COMPLETED_LABELS,
  failedFallback = "Local setup step failed.",
): string {
  if (status.phase !== "starting" || status.step === undefined) return fallback;
  if (status.step.status === "failed") return safeBootstrapErrorMessage(status.step.message ?? failedFallback, failedFallback);
  const labels = status.step.status === "completed" ? completedStepLabels : stepLabels;
  return safeBootstrapErrorMessage(labels[status.step.step] ?? status.step.message ?? fallback, fallback);
}
