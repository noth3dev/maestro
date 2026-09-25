import type { BootstrapStatus } from "./global.js";
import { redactSensitiveText } from "./lib/command-id.js";

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

export function bootstrapProgressText(
  status: BootstrapStatus,
  fallback = "preparing the local Control Plane…",
  stepLabels: Readonly<Record<string, string>> = STEP_LABELS,
  completedStepLabels: Readonly<Record<string, string>> = STEP_COMPLETED_LABELS,
  failedFallback = "Local setup step failed.",
): string {
  if (status.phase !== "starting" || status.step === undefined) return fallback;
  if (status.step.status === "failed") return redactSensitiveText(status.step.message ?? failedFallback);
  const labels = status.step.status === "completed" ? completedStepLabels : stepLabels;
  return redactSensitiveText(labels[status.step.step] ?? status.step.message ?? fallback);
}
