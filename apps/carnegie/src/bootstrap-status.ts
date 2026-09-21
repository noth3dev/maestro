import type { BootstrapStatus } from "./global.js";

const STEP_LABELS: Record<string, string> = {
  "docker-check": "checking Docker availability…",
  "postgres-ready": "starting the local database…",
  migrations: "running database migrations…",
  "control-plane-up": "starting the Control Plane…",
  "model-gateway-up": "starting the model gateway…",
};

export function bootstrapProgressText(status: BootstrapStatus): string {
  if (status.phase !== "starting" || status.step === undefined) return "preparing the local Control Plane…";
  return status.step.message ?? STEP_LABELS[status.step.step] ?? "preparing the local Control Plane…";
}
