import { GitOperationError } from "@maestro/domain";
import {
  CapabilityApprovalConflictError, EvidenceMetadataConflictError,
  HeadActivationCycleError, HeadActivationBindingConflictError, HeadActivationRuntimeConflictError,
  HeadCouncilNotFoundError, CouncilBriefsSealedError, CouncilProtocolError,
  DepartmentPlanError, DepartmentPlanNotFoundError, MissionBundleError, MissionBundleNotFoundError,
  GitIntegrationError, GitIntegrationNotFoundError, CertificationError, CertificationNotFoundError,
  MetronomeChallengeError, MetronomeChallengeNotFoundError, MetronomeAuthorizationError,
  EncoreCouncilError, StaleGoalLeaseError, HeadActivationRequesterInactiveError, DiscordPersistenceError,
  WorkerError, WorkerNotFoundError,
  ProjectAccessAdminRequiredError, ProjectAccessRoleNotFoundError, ProjectAccessTargetNotFoundError,
  ProjectMembershipRequiredError, ProjectRoleRequiredError,
} from "@maestro/persistence";
import {
  StableApiErrorSchema,
  type StableApiError,
} from "@maestro/contracts";
import {
  CommandIdReuseError, DurableStoreUnavailableError, GoalNotFoundError, InvalidTransitionError,
  LeaseUnavailableError, StaleLeaseError, VersionConflictError,
  TaskContractIntegrityError as GoalTaskContractIntegrityError,
} from "./goal-service.js";
import {
  CriticalActionApprovalConflictError, CriticalActionApprovalExpiredError,
  CriticalActionApprovalForbiddenError,
  CriticalActionUnavailableError, CriticalActionGoalNotFoundError,
  CriticalActionProjectMismatchError,
} from "./critical-action-service.js";
import { ReadStateGoalNotFoundError } from "./read-state-service.js";
import {
  ExactConfirmationRequiredError, TaskContractConflictError, TaskContractIntegrityError,
  TaskContractNotFoundError, TaskContractProjectBoundaryError, TaskContractProjectMismatchError,
  TaskContractVersionConflictError,
} from "./task-contract-service.js";
import {
  HeadGoalNotFoundError, HeadProjectMismatchError, HeadContractMismatchError,
} from "./head-participation-service.js";
import {
  CouncilContractMismatchError, CouncilGoalNotFoundError, CouncilProjectMismatchError,
} from "./council-service.js";
import { DepartmentPlanProjectMismatchError } from "./department-plan-service.js";
import { MissionBundleProjectMismatchError } from "./mission-bundle-service.js";
import { WorkerMessageRejectedError, WorkerProjectMismatchError, WorkerCapacityExceededError } from "./worker-service.js";
import { ConversationConflictError, ConversationModelNotAllowedError, ConversationNotFoundError, ConversationUnavailableError } from "./conversation-service.js";
import { ModelGatewayClientError } from "./model-gateway-client.js";
import { EncoreProjectMismatchError } from "./encore-service.js";
import { EvidenceCaptureError, EvidenceCaptureGoalBindingError } from "./evidence-capture-service.js";
import { CapabilityApprovalUnauthorizedError, CapabilityApprovalInvalidRequestError } from "./capability-approval-service.js";
import { GitProjectMismatchError } from "./git-integration-service.js";
import { GitAuthorizationError } from "@maestro/git-adapter";
import { AuthenticationRequiredError, AuthenticationUnavailableError, CredentialForbiddenError, CriticalActionDeniedError, CriticalActionRequiresApprovalError, RequestValidationError, isMalformedJsonError } from "./server-input.js";

export function mapError(error: unknown): { status: number; body: StableApiError } {
  if (isMalformedJsonError(error) || error instanceof RequestValidationError) return apiError(400, "validation_error", "Invalid request");
  if (error instanceof AuthenticationRequiredError) return apiError(401, "authentication_required", "Authentication is required");
  if (error instanceof CredentialForbiddenError) return apiError(403, "credential_forbidden", "Credential is not active");
  if (error instanceof CapabilityApprovalUnauthorizedError) return apiError(403, "capability_unauthorized", error.message);
  if (error instanceof CapabilityApprovalInvalidRequestError || error instanceof EvidenceCaptureError || error instanceof EvidenceCaptureGoalBindingError) return apiError(400, "validation_error", error.message);
  if (error instanceof CapabilityApprovalConflictError || error instanceof EvidenceMetadataConflictError) return apiError(409, "replay_conflict", error.message);
  if (error instanceof AuthenticationUnavailableError) return apiError(429, "authentication_unavailable", "Authentication is temporarily unavailable");
  if (error instanceof TaskContractProjectMismatchError || error instanceof TaskContractProjectBoundaryError || error instanceof CriticalActionProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof CriticalActionGoalNotFoundError) return apiError(404, "goal_not_found", error.message);
  if (error instanceof HeadGoalNotFoundError) return apiError(404, "goal_not_found", "Goal was not found");
  if (error instanceof HeadProjectMismatchError || error instanceof HeadContractMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof HeadActivationCycleError) return apiError(409, "head_activation_cycle", error.message);
  if (error instanceof HeadActivationBindingConflictError || error instanceof HeadActivationRuntimeConflictError || error instanceof HeadActivationRequesterInactiveError) return apiError(409, "head_activation_conflict", error.message);
  if (error instanceof CouncilGoalNotFoundError) return apiError(404, "goal_not_found", error.message);
  if (error instanceof CouncilProjectMismatchError || error instanceof CouncilContractMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof HeadCouncilNotFoundError) return apiError(404, "council_not_found", error.message);
  if (error instanceof CouncilBriefsSealedError) return apiError(409, "council_briefs_sealed", error.message);
  if (error instanceof CouncilProtocolError) return apiError(409, "council_conflict", error.message);
  if (error instanceof DepartmentPlanProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof DepartmentPlanNotFoundError) return apiError(404, "department_plan_not_found", error.message);
  if (error instanceof DepartmentPlanError) return apiError(409, "department_plan_conflict", error.message);
  if (error instanceof MissionBundleProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof MissionBundleNotFoundError) return apiError(404, "mission_bundle_not_found", error.message);
  if (error instanceof MissionBundleError) return apiError(409, "mission_bundle_conflict", error.message);
  if (error instanceof WorkerProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof WorkerCapacityExceededError) return apiError(429, "worker_capacity_exceeded", error.message);
  if (error instanceof WorkerMessageRejectedError) return apiError(409, "worker_message_rejected", error.message);
  if (error instanceof WorkerNotFoundError) return apiError(404, "worker_not_found", error.message);
  if (error instanceof WorkerError) return apiError(409, "worker_conflict", error.message);
  if (error instanceof GitProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof GitIntegrationNotFoundError) return apiError(404, "git_integration_not_found", error.message);
  if (error instanceof GitIntegrationError) return apiError(409, "git_integration_conflict", error.message);
  if (error instanceof GitAuthorizationError) return apiError(403, "authority_denied", error.message);
  if (error instanceof GitOperationError) return apiError(409, "git_integration_conflict", error.message);
  if (error instanceof CertificationNotFoundError) return apiError(404, "certification_not_found", error.message);
  if (error instanceof CertificationError) return apiError(409, "certification_conflict", error.message);
  if (error instanceof MetronomeChallengeNotFoundError) return apiError(404, "metronome_not_found", error.message);
  if (error instanceof MetronomeAuthorizationError) return apiError(403, "authority_denied", error.message);
  if (error instanceof MetronomeChallengeError) return apiError(409, "metronome_conflict", error.message);
  if (error instanceof EncoreProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof EncoreCouncilError) return apiError(409, "encore_conflict", error.message);
  if (error instanceof DiscordPersistenceError) return apiError(400, "discord_signal_rejected", error.message);
  if (error instanceof ModelGatewayClientError) {
    if (error.code === "model_not_allowed") return apiError(400, "model_not_allowed", "Requested model is not allowed");
    if (error.code === "account_login_session_unknown") return apiError(409, "account_login_session_unknown", "Account login session is unknown");
    return apiError(503, "provider_unavailable", "Provider is currently unavailable");
  }
  if (error instanceof ConversationNotFoundError) return apiError(404, "conversation_not_found", "Conversation was not found");
  if (error instanceof ConversationConflictError) return apiError(409, "conversation_conflict", error.message);
  if (error instanceof ConversationModelNotAllowedError) return apiError(400, "model_not_allowed", "Requested model is not allowed");
  if (error instanceof ConversationUnavailableError) return apiError(503, "conversation_unavailable", error.message);
  if (error instanceof TaskContractIntegrityError || error instanceof GoalTaskContractIntegrityError) return apiError(503, "task_contract_integrity_error", error.message);
  if (error instanceof TaskContractNotFoundError) return apiError(404, "task_contract_not_found", "Task Contract was not found");
  if (error instanceof TaskContractConflictError) return apiError(409, "task_contract_conflict", error.message);
  if (error instanceof TaskContractVersionConflictError) return apiError(409, "task_contract_version_conflict", error.message);
  if (error instanceof ExactConfirmationRequiredError) return apiError(409, "exact_confirmation_required", error.message);
  if (error instanceof TaskContractIntegrityError || error instanceof GoalTaskContractIntegrityError) return apiError(503, "task_contract_integrity_error", error.message);
  if (error instanceof VersionConflictError) return apiError(409, "version_conflict", error.message);
  if (error instanceof InvalidTransitionError) return apiError(422, "invalid_transition", error.message);
  if (error instanceof GoalNotFoundError || error instanceof ReadStateGoalNotFoundError) return apiError(404, "goal_not_found", "Goal was not found");
  if (error instanceof StaleLeaseError || error instanceof StaleGoalLeaseError) return apiError(409, "stale_lease", error.message);
  if (error instanceof LeaseUnavailableError) return apiError(423, "lease_unavailable", error.message);
  if (error instanceof CommandIdReuseError) return apiError(409, "command_id_reused", error.message);
  if (error instanceof CriticalActionDeniedError) return apiError(403, "critical_action_denied", error.message);
  if (error instanceof CriticalActionRequiresApprovalError) return apiError(409, "critical_action_requires_approval", error.message);
  if (error instanceof CriticalActionApprovalForbiddenError) return apiError(403, "critical_action_approval_forbidden", error.message);
  if (error instanceof CriticalActionApprovalExpiredError) return apiError(400, "validation_error", error.message);
  if (error instanceof CriticalActionApprovalConflictError) return apiError(409, "command_id_reused", error.message);
  if (error instanceof CriticalActionUnavailableError) return apiError(503, "durable_store_unavailable", error.message);
  if (error instanceof DurableStoreUnavailableError) return apiError(503, "durable_store_unavailable", error.message);
  if (error instanceof ProjectAccessAdminRequiredError) return apiError(403, "authority_denied", error.message);
  if (error instanceof ProjectAccessTargetNotFoundError || error instanceof ProjectAccessRoleNotFoundError) return apiError(400, "validation_error", "Invalid project access request");
  if (error instanceof ProjectMembershipRequiredError || error instanceof ProjectRoleRequiredError) return apiError(403, "project_access_forbidden", error.message);
  return apiError(503, "durable_store_unavailable", "Durable store is unavailable");
}

function apiError(status: number, code: StableApiError["error"]["code"], message: string) {
  return { status, body: StableApiErrorSchema.parse({ error: { code, message } }) };
}
