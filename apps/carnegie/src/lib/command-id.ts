import { ApiError } from "@maestro/api-client";

/** A fresh idempotency/command ID for one mutating API call. Never reuse one across retries with different content. */
export function newCommandId(): string {
  return crypto.randomUUID();
}

export interface ClassifiedApiError {
  readonly title: string;
  readonly detail: string;
  /** True when simply retrying the same request (often with a fresh command ID) can succeed without new operator input. */
  readonly retryable: boolean;
}

const RETRYABLE_CODES = new Set<string>([
  "version_conflict",
  "task_contract_version_conflict",
  "stale_lease",
  "lease_unavailable",
  "durable_store_unavailable",
  "authentication_unavailable",
  "provider_unavailable",
  "replay_conflict",
  "command_id_reused",
  "conversation_unavailable",
  "worker_capacity_exceeded",
  "council_conflict",
  "department_plan_conflict",
  "mission_bundle_conflict",
  "worker_conflict",
  "git_integration_conflict",
  "certification_conflict",
  "metronome_conflict",
  "encore_conflict",
  "channel_conflict",
  "task_contract_conflict",
  "head_activation_conflict",
]);

const TITLES: Record<string, string> = {
  version_conflict: "This changed elsewhere",
  task_contract_version_conflict: "The draft changed elsewhere",
  stale_lease: "Lost the execution lease",
  lease_unavailable: "Busy elsewhere right now",
  durable_store_unavailable: "Control plane storage is unavailable",
  authentication_required: "Sign-in required",
  authentication_unavailable: "Authentication is temporarily unavailable",
  credential_forbidden: "Credential rejected",
  critical_action_denied: "Action denied",
  authority_denied: "Not authorized",
  critical_action_requires_approval: "Approval required",
  critical_action_approval_forbidden: "Approval not permitted",
  routing_shortfall: "No model meets this Goal's requirement",
  provider_unavailable: "Model provider is unavailable",
  model_not_allowed: "Requested model is not allowed",
  project_access_forbidden: "No access to this project",
  goal_not_found: "Goal not found",
  task_contract_not_found: "Task Contract not found",
  worker_not_found: "Worker not found",
  channel_not_found: "Channel not found",
  channel_closed: "Channel is closed",
  conversation_not_found: "Conversation not found",
  exact_confirmation_required: "Exact confirmation required",
  task_contract_integrity_error: "Task Contract content does not match its hash",
  validation_error: "That input isn't valid",
};

/** Turns any thrown value from a bridged API call into stable, renderable state. Never inspects a token or header. */
export function classifyApiError(error: unknown): ClassifiedApiError {
  if (error instanceof ApiError) {
    return {
      title: TITLES[error.code] ?? "Request failed",
      detail: error.detail ?? error.message,
      retryable: RETRYABLE_CODES.has(error.code),
    };
  }
  if (error instanceof Error) {
    if (error.message === "Not connected to a control plane yet") {
      return { title: "Not connected", detail: error.message, retryable: false };
    }
    if (error.message === "Method not exposed to the renderer" || error.message.startsWith("Method not exposed to the renderer:")) {
      return { title: "Unsupported action", detail: error.message, retryable: false };
    }
    return { title: "Connection problem", detail: error.message, retryable: true };
  }
  return { title: "Unexpected error", detail: "An unknown error occurred.", retryable: true };
}
