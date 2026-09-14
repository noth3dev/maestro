import type { ApiClient } from "@maestro/api-client";
import type { TaskContract, TaskContractSubstance } from "@maestro/contracts";

export type TaskContractAuthoringApi = Pick<
  ApiClient,
  "createTaskContract" | "getTaskContract" | "updateTaskContract" | "confirmTaskContract" | "launchTaskContract"
>;

type EditableTaskContractFields = Partial<Omit<TaskContractSubstance, "project" | "budget">> & {
  project?: Partial<TaskContractSubstance["project"]>;
  budget?: Partial<TaskContractSubstance["budget"]>;
};

const newId = (): string => globalThis.crypto.randomUUID();

/** Build the first server-bound draft. Placeholder project fields stay visible and editable. */
export function buildTaskContractDraft(projectId: string, brief: string): TaskContractSubstance {
  const desiredOutcome = brief.trim();
  if (desiredOutcome === "") throw new Error("A brief is required to create a Task Contract draft");

  return {
    desiredOutcome,
    userVisibleBehavior: [`The requested outcome is visible to the CEO.`],
    successCriteria: [`The requested outcome is verified before completion.`],
    liveEvidence: ["Durable Control Plane Task Contract record"],
    scope: [`Project ${projectId} only`],
    nonGoals: ["Unrelated work"],
    priorities: ["Correctness and safety"],
    acceptableTradeoffs: ["Keep the first draft bounded"],
    constraints: ["Critical actions require the durable approval path"],
    knownEdgeCases: ["Validation failure", "Concurrent edits"],
    project: {
      projectId,
      repository: "Repository not selected",
      immutableBaseRevision: "Base revision not selected",
      dataBoundary: "Project-scoped data only",
    },
    evidenceReferences: [],
    approvedPreviewReferences: [],
    expectedGroups: [],
    expectedDepartments: [],
    criticalActionExpectations: ["Show the exact effect before any critical action"],
    forbiddenEffects: ["Unapproved external effects"],
    environmentAssumptions: ["Configured Maestro project"],
    externalServiceAssumptions: [],
    budget: {
      ceiling: "Server-defined",
      reportingExpectations: ["Report durable state"],
      stoppingConditions: ["Stop when the server rejects or scope changes"],
    },
  };
}

export async function createTaskContractDraft(
  api: TaskContractAuthoringApi,
  input: { projectId: string; substance: TaskContractSubstance },
  contractId = newId(),
): Promise<TaskContract> {
  return api.createTaskContract(input, contractId);
}

function substanceOf(contract: TaskContract): TaskContractSubstance {
  const { contractId: _contractId, schemaVersion: _schemaVersion, version: _version, decisionHistory: _decisionHistory, contentHash: _contentHash, launchState: _launchState, ...substance } = contract;
  return substance;
}

export async function updateTaskContractDraft(
  api: TaskContractAuthoringApi,
  contract: TaskContract,
  edits: EditableTaskContractFields,
  commandId = newId(),
): Promise<TaskContract> {
  const current = substanceOf(contract);
  const next: TaskContractSubstance = {
    ...current,
    ...edits,
    project: { ...current.project, ...edits.project },
    budget: { ...current.budget, ...edits.budget },
  };
  return api.updateTaskContract(contract.contractId, {
    projectId: contract.project.projectId,
    expectedVersion: contract.version,
    substance: next,
  }, commandId);
}

export async function confirmTaskContractDraft(api: TaskContractAuthoringApi, contract: TaskContract, commandId = newId()): Promise<void> {
  await api.confirmTaskContract(contract.contractId, {
    projectId: contract.project.projectId,
    version: contract.version,
    contentHash: contract.contentHash,
  }, commandId);
}

/** Launch is intentionally separate from confirmation; callers must invoke it explicitly. */
export async function launchTaskContractDraft(api: TaskContractAuthoringApi, contract: TaskContract, commandId = newId()): Promise<TaskContract> {
  return api.launchTaskContract(contract.contractId, contract.project.projectId, commandId);
}
