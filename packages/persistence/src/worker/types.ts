import { type ExecutionAdmission, type InvocationContext, type MissionBundle, type RoutingEvidence } from "@maestro/domain";

export class WorkerError extends Error {}
export class WorkerProviderOutcomeUnknownError extends WorkerError {
  constructor(message = "Provider outcome is unknown; capacity remains reserved until reconciliation") {
    super(message);
    this.name = "WorkerProviderOutcomeUnknownError";
  }
}
export class WorkerNotFoundError extends WorkerError {}

export type WorkerRoutingEvidenceDraft = Omit<RoutingEvidence, "evidenceId" | "admissionBindingRef" | "createdAt"> & {
  readonly evidenceId?: undefined;
  readonly admissionBindingRef?: undefined;
  readonly createdAt?: undefined;
};

export interface WorkerAdmissionDecision {
  readonly admission: ExecutionAdmission;
  readonly routingEvidence?: WorkerRoutingEvidenceDraft;
}

export interface WorkerAdmissionFactoryInput {
  /** Authenticated operator who requested this worker admission. */
  readonly operatorId: string;
  readonly workerId: string;
  readonly routeRef: string;
  readonly bundle: MissionBundle;
  readonly base: {
    readonly context: InvocationContext;
    readonly grant: Omit<import("@maestro/domain").CapabilityGrant, "modelPolicy">;
    readonly idempotencyKey: string;
  };
}

export interface SpawnWorkerRequest {
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  /** Stable API command identity for replay-safe worker creation. */
  readonly commandId?: string;
  readonly itemId: string;
  /** Validated owned worktree directory supplied by the orchestration layer. */
  readonly cwd?: string;
  /** Declared target identity included in the replay hash when present. */
  readonly repositoryPath?: string;
  readonly worktreePath?: string;
  /** Called after the durable reservation and before provider admission to create the owned target worktree. */
  readonly prepareWorktree?: (workerId: string) => Promise<string>;
  /** Exact provider-qualified model selected by the host and checked against the Mission Bundle. */
  readonly modelRef?: string;
  /** Authenticated operator for the ensemble-only host seam. Pin callers may leave this undefined. */
  readonly operatorId?: string;
  /** Ensemble-only host seam. Pin callers leave this undefined and retain the existing path. */
  readonly createAdmission?: (input: WorkerAdmissionFactoryInput) => Promise<WorkerAdmissionDecision>;
}
