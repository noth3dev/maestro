import type {
  AcceptWorkerInput,
  Certification,
  CertifyWorkerInput,
  DepartmentAcceptance,
  DepartmentBranchInput,
  EvidenceCaptureInput,
  GoalIntegrationBranchInput,
  GoalIntegrationRevision,
  IntegrationCommit,
  WorkerIntegrationInput,
  WorkerWorktreeInput,
} from "@maestro/contracts";
import type { ApiClient, CertificationList, EvidenceBundleRead, GoalGitIntegrationState } from "@maestro/api-client";

export type IntegrationApi = Pick<
  ApiClient,
  | "createGoalIntegrationBranch"
  | "createDepartmentBranch"
  | "createWorkerWorktree"
  | "advanceWorkerIntegration"
  | "freezeGoalIntegrationRevision"
  | "getGitIntegrationState"
  | "acceptWorker"
  | "certifyWorker"
  | "certifyConditionalWorker"
  | "captureEvidence"
  | "getEvidenceBundle"
  | "getEvidenceDump"
  | "listCertifications"
>;

export function createGoalIntegrationBranch(
  api: Pick<IntegrationApi, "createGoalIntegrationBranch">,
  goalId: string,
  input: GoalIntegrationBranchInput,
  commandId: string,
) {
  return api.createGoalIntegrationBranch(goalId, input, commandId);
}

export function createWorkerWorktree(
  api: Pick<IntegrationApi, "createWorkerWorktree">,
  workerId: string,
  input: WorkerWorktreeInput,
  commandId: string,
) {
  return api.createWorkerWorktree(workerId, input, commandId);
}

export async function advanceWorkerIntegrationFromRevision(
  api: Pick<IntegrationApi, "advanceWorkerIntegration">,
  workerId: string,
  projectId: string,
  currentRevision: GoalIntegrationRevision | null | undefined,
  input: Omit<WorkerIntegrationInput, "projectId">,
  commandId: string,
) {
  if (currentRevision === null || currentRevision === undefined) throw new Error("A current integration revision is required");
  return api.advanceWorkerIntegration(workerId, { projectId, ...input }, commandId);
}

/** Reads the Goal's real Git identity from the control plane. Never synthesized in the renderer. */
export function getGitIntegrationState(
  api: Pick<IntegrationApi, "getGitIntegrationState">,
  goalId: string,
  query: { projectId: string },
): Promise<GoalGitIntegrationState> {
  return api.getGitIntegrationState(goalId, query);
}

/** A department branch can only be requested against a project the caller is scoped to; there is no other input to fabricate. */
export function createDepartmentBranch(
  api: Pick<IntegrationApi, "createDepartmentBranch">,
  councilId: string,
  departmentId: string,
  input: DepartmentBranchInput,
  commandId: string,
) {
  return api.createDepartmentBranch(councilId, departmentId, input, commandId);
}

/**
 * Freezing a revision only makes sense once the Goal has a real integration branch. The renderer
 * refuses to call the server without that durable branch identity, instead of freezing a revision
 * against a branch that does not exist yet.
 */
export async function freezeGoalIntegrationRevisionFromBranch(
  api: Pick<IntegrationApi, "freezeGoalIntegrationRevision">,
  goalId: string,
  branchExists: boolean,
  input: DepartmentBranchInput,
  commandId: string,
): Promise<GoalIntegrationRevision> {
  if (!branchExists) throw new Error("A Goal integration branch is required before freezing a revision");
  return api.freezeGoalIntegrationRevision(goalId, input, commandId);
}

export function listCertifications(
  api: Pick<IntegrationApi, "listCertifications">,
  goalId: string,
  query: { projectId: string },
): Promise<CertificationList> {
  return api.listCertifications(goalId, query);
}

export function getEvidenceBundle(
  api: Pick<IntegrationApi, "getEvidenceBundle">,
  goalId: string,
  query: { projectId: string },
): Promise<EvidenceBundleRead> {
  return api.getEvidenceBundle(goalId, query);
}

export function getEvidenceDump(api: Pick<IntegrationApi, "getEvidenceDump">, goalId: string, query: { projectId: string }) {
  return api.getEvidenceDump(goalId, query);
}

/** Evidence is captured verbatim from the documented input; there is no separate "draft" or editable path. */
export function captureEvidence(api: Pick<IntegrationApi, "captureEvidence">, goalId: string, input: EvidenceCaptureInput) {
  return api.captureEvidence(goalId, input);
}

/**
 * Worker acceptance requires a real integration commit that the server produced. There is no way
 * to accept a Worker whose work was never actually integrated.
 */
export async function acceptWorkerAfterIntegration(
  api: Pick<IntegrationApi, "acceptWorker">,
  workerId: string,
  integrationCommit: IntegrationCommit | undefined,
  input: AcceptWorkerInput,
  commandId: string,
): Promise<DepartmentAcceptance> {
  if (integrationCommit === undefined) throw new Error("A real integration commit is required before accepting the Worker");
  if (integrationCommit.workerId !== workerId) throw new Error("Integration commit does not match the selected Worker");
  if (integrationCommit.evidenceReferences.length === 0) throw new Error("Integration commit has no evidence references");
  return api.acceptWorker(workerId, input, commandId);
}

/** Certification, conditional or not, requires the department to have already accepted the Worker's real commit. */
export async function certifyWorkerAfterAcceptance(
  api: Pick<IntegrationApi, "certifyWorker">,
  workerId: string,
  acceptance: DepartmentAcceptance | undefined,
  input: CertifyWorkerInput,
  commandId: string,
): Promise<Certification> {
  if (acceptance === undefined) throw new Error("Department acceptance is required before certification");
  if (acceptance.workerId !== workerId) throw new Error("Department acceptance does not match the selected Worker");
  return api.certifyWorker(workerId, input, commandId);
}

export async function certifyConditionalWorkerAfterAcceptance(
  api: Pick<IntegrationApi, "certifyConditionalWorker">,
  workerId: string,
  acceptance: DepartmentAcceptance | undefined,
  kind: "security" | "safety_compliance",
  input: CertifyWorkerInput,
  commandId: string,
): Promise<Certification> {
  if (acceptance === undefined) throw new Error("Department acceptance is required before conditional certification");
  if (acceptance.workerId !== workerId) throw new Error("Department acceptance does not match the selected Worker");
  return api.certifyConditionalWorker(workerId, kind, input, commandId);
}
