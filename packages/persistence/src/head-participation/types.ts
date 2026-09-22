import type { HeadParticipationStatus } from "@maestro/domain";

export interface ActivateHeadRequest {
  readonly goalId: string;
  readonly departmentId: string;
  /** Stable API command identity used for replay-safe activation. */
  readonly commandId?: string;
  /** Stable permanent Head identity. The database verifies it maps to departmentId. */
  readonly headRoleId?: string;
  /** The selected Task Contract, when one exists. No contract body is copied here. */
  readonly contractId?: string;
  /** Goal-scoped context identity. Context contents are assembled elsewhere. */
  readonly contextId?: string;
  /** Required bounded Head activation brief fields retained in the audit attempt. */
  readonly requestedContribution: string;
  readonly urgency: string;
  readonly contextScope: readonly string[];
  readonly budgetEffect: string;
  readonly requester?:
    | { readonly role: "Concertmaster" }
    | { readonly role: "Head"; readonly departmentId: string; readonly headRoleId?: string };
  readonly reason: string;
  readonly evidence?: Record<string, unknown>;
}

export class HeadActivationCycleError extends Error {
  readonly code = "head_activation_cycle";
  constructor() { super("Head activation would create a cycle"); this.name = "HeadActivationCycleError"; }
}

export class HeadActivationRequesterInactiveError extends Error {
  readonly code = "head_activation_requester_inactive";
  constructor() { super("A Head requester must have an active Goal participation"); this.name = "HeadActivationRequesterInactiveError"; }
}

export class HeadActivationRuntimeConflictError extends Error {
  readonly code = "head_runtime_conflict";
  constructor() { super("The permanent Head already has an active runtime binding"); this.name = "HeadActivationRuntimeConflictError"; }
}

export class HeadActivationBindingConflictError extends Error {
  readonly code = "head_activation_binding_conflict";
  constructor(message = "Head activation binding does not match the existing Goal participation") {
    super(message);
    this.name = "HeadActivationBindingConflictError";
  }
}

// Keep the shorter name available to callers that treat the binding as a
// validation error rather than a conflict response.
export { HeadActivationBindingConflictError as HeadActivationBindingError };

export type ParticipationRow = {
  goal_id: string;
  department_id: string;
  head_role_id: string;
  contract_id: string | null;
  context_id: string | null;
  status: HeadParticipationStatus;
  active_session_ref: string | null;
};
export type HeadRequester =
  | { readonly role: "Concertmaster" }
  | { readonly role: "Head"; readonly departmentId: string; readonly headRoleId?: string };
export type HeadActivationCommandStatus = "reserved" | "spawn_started" | "active" | "orphaned";
export interface HeadActivationCommandRecoveryRow {
  commandId: string;
  goalId: string;
  departmentId: string;
  status: HeadActivationCommandStatus;
  providerExecutionRef: string | null;
  providerInvocationRef: string | null;
  activeSessionRef: string | null;
}
export type AttemptOutcome = "reserved" | "already_active" | "cycle_rejected" | "runtime_conflict" | "binding_conflict";
export type ActivationBrief = {
  readonly requestedContribution: string;
  readonly urgency: string;
  readonly contextScope: readonly string[];
  readonly budgetEffect: string;
};
