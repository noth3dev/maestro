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

/** Redacts credential-shaped values before an API error reaches visible renderer text. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/((?:["']?(?:authorization|token|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|api[-_ ]?key|client[_ -]?secret|secret|password|credential)["']?)\s*[:=]\s*)(["']?)(?:Bearer\s+)?[^\s,;}"']+(["']?)/gi, "$1$2[redacted]$3")
    .replace(/\bBearer\s+[^\s,;}"']+/gi, "Bearer [redacted]");
}

interface ApiErrorShape {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}

function isApiErrorShape(error: unknown): error is ApiErrorShape {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return typeof candidate.status === "number" && typeof candidate.code === "string" && typeof candidate.message === "string";
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
  "conversation_conflict",
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
  task_contract_conflict: "Task Contract changed elsewhere",
  exact_confirmation_required: "Exact confirmation required",
  task_contract_integrity_error: "Task Contract content does not match its hash",
  validation_error: "That input isn't valid",
  invalid_transition: "Invalid Goal transition",
  command_id_reused: "Command ID was already used",
  head_activation_cycle: "Head activation cycle detected",
  head_activation_conflict: "Head activation changed elsewhere",
  council_not_found: "Council not found",
  council_conflict: "Council changed elsewhere",
  council_briefs_sealed: "Council briefs are sealed",
  department_plan_not_found: "Department Plan not found",
  department_plan_conflict: "Department Plan changed elsewhere",
  mission_bundle_not_found: "Mission Bundle not found",
  mission_bundle_conflict: "Mission Bundle changed elsewhere",
  worker_not_found: "Worker not found",
  worker_conflict: "Worker changed elsewhere",
  git_integration_not_found: "Git integration not found",
  git_integration_conflict: "Git integration changed elsewhere",
  certification_not_found: "Certification not found",
  certification_conflict: "Certification changed elsewhere",
  metronome_not_found: "Metronome finding not found",
  metronome_conflict: "Metronome finding changed elsewhere",
  encore_not_found: "Encore review not found",
  encore_conflict: "Encore review changed elsewhere",
  discord_signal_rejected: "Discord signal rejected",
  worker_capacity_exceeded: "Worker capacity is full",
  worker_message_rejected: "Worker message rejected",
  conversation_not_found: "Conversation not found",
  conversation_conflict: "Conversation changed elsewhere",
  conversation_unavailable: "Conversation service is unavailable",
  account_login_session_unknown: "Account login session not found",
  capability_unauthorized: "Capability not authorized",
  replay_conflict: "Replay conflicts with current state",
  channel_not_found: "Channel not found",
  channel_conflict: "Channel changed elsewhere",
  channel_closed: "Channel is closed",
};

/** Turns any thrown value from a bridged API call into stable, renderable state. Never inspects a token or header. */
export function classifyApiError(error: unknown): ClassifiedApiError {
  if (error instanceof ApiError || isApiErrorShape(error)) {
    const code = error.code;
    return {
      title: TITLES[code] ?? "Request failed",
      detail: redactSensitiveText(error.detail ?? error.message),
      retryable: RETRYABLE_CODES.has(code),
    };
  }
  if (error instanceof Error) {
    const detail = redactSensitiveText(error.message);
    if (error.message === "Not connected to a control plane yet") {
      return { title: "Not connected", detail, retryable: false };
    }
    if (error.message === "Method not exposed to the renderer" || error.message.startsWith("Method not exposed to the renderer:")) {
      return { title: "Unsupported action", detail, retryable: false };
    }
    return { title: "Connection problem", detail, retryable: true };
  }
  return { title: "Unexpected error", detail: "An unknown error occurred.", retryable: true };
}
