import type { ApiClient } from "@maestro/api-client";
import { type ConversationTurn, type TaskContract, type TaskContractLaunchResult, type TaskContractSubstance } from "@maestro/contracts";

export type TaskContractAuthoringApi = Pick<
  ApiClient,
  "createTaskContract" | "getTaskContract" | "updateTaskContract" | "confirmTaskContract" | "launchTaskContract"
>;

export type GoalLessIntakeApi = Pick<ApiClient, "listModels" | "createConversation" | "sendConversationTurn">;

export type GoalLessIntakeResult = {
  conversationId: string;
  response: string;
  turnId: string;
  draft: TaskContract | undefined;
  message: string | undefined;
  turnStatus: ConversationTurn["status"];
};

export class ConversationTurnError extends Error {
  readonly conversationId: string;
  readonly cause: unknown;

  constructor(conversationId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ConversationTurnError";
    this.conversationId = conversationId;
    this.cause = cause;
  }
}

type EditableTaskContractFields = Partial<Omit<TaskContractSubstance, "project" | "budget">> & {
  project?: Partial<TaskContractSubstance["project"]>;
  budget?: Partial<TaskContractSubstance["budget"]>;
};

const newId = (): string => globalThis.crypto.randomUUID();

/** Stable, complete JSON representation shown before a Task Contract confirmation. */
export function formatTaskContractReview(contract: TaskContract): string {
  return JSON.stringify(contract, null, 2);
}

/** Send Home's no-Goal brief through the same durable conversation routes as the TUI. */
export async function submitGoalLessBrief(
  api: GoalLessIntakeApi,
  input: {
    projectId: string;
    text: string;
    goalId?: string;
    modelRef?: string;
    reasoningEffort?: string;
    conversationId?: string;
    onConversationCreated?: (conversationId: string) => void;
  },
): Promise<GoalLessIntakeResult> {
  const text = input.text.trim();
  if (text === "") throw new Error("A brief is required to start a Concertmaster conversation");

  let conversationId = input.conversationId;
  if (conversationId === undefined) {
    const models = await api.listModels();
    const selected =
      input.modelRef === undefined
        ? models[0]
        : models.find((candidate) => `${candidate.identity.provider}/${candidate.identity.id}` === input.modelRef);
    if (selected === undefined) {
      throw new Error(input.modelRef === undefined ? "No Concertmaster model is available" : "Selected Concertmaster model is no longer available");
    }
    const model = `${selected.identity.provider}/${selected.identity.id}`;
    if (input.reasoningEffort !== undefined && !selected.reasoningEfforts?.supported.includes(input.reasoningEffort))
      throw new Error("Selected thinking strength is no longer available for this model");
    const conversation = await api.createConversation(
      { projectId: input.projectId, goalId: input.goalId ?? null, model, ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }) },
      { idempotencyKey: globalThis.crypto.randomUUID() },
    );
    conversationId = conversation.conversationId;
    input.onConversationCreated?.(conversationId);
  }

  let result: Awaited<ReturnType<GoalLessIntakeApi["sendConversationTurn"]>>;
  try {
    result = await api.sendConversationTurn(
      conversationId,
      { projectId: input.projectId, text },
      { idempotencyKey: globalThis.crypto.randomUUID() },
    );
  } catch (cause) {
    throw new ConversationTurnError(conversationId, cause);
  }
  return {
    conversationId,
    response: result.turn.content,
    turnId: result.turn.turnId,
    draft: undefined,
    message: undefined,
    turnStatus: result.turn.status,
  };
}

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

export type HomeBriefApi = GoalLessIntakeApi & TaskContractAuthoringApi;

/** Route Home through goal-less conversation intake, retaining direct authoring for attached Goals. */
export async function submitHomeBrief(
  api: HomeBriefApi,
  input: {
    projectId: string;
    text: string;
    selectedGoalId: string | undefined;
    modelRef?: string;
    reasoningEffort?: string;
    conversationId?: string;
    onConversationCreated?: (conversationId: string) => void;
  },
): Promise<GoalLessIntakeResult> {
  return submitGoalLessBrief(api, {
    projectId: input.projectId,
    text: input.text,
    ...(input.selectedGoalId === undefined ? {} : { goalId: input.selectedGoalId }),
    ...(input.modelRef === undefined ? {} : { modelRef: input.modelRef }),
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    ...(input.onConversationCreated === undefined ? {} : { onConversationCreated: input.onConversationCreated }),
  });
}

function assertNotLaunched(contract: TaskContract): void {
  if (contract.launchState === "launched") throw new Error("Task Contract is already launched");
}

export type TaskContractPhase = "draft" | "confirmed" | "launched" | "rejected";

export function getTaskContractPhase(contract: TaskContract, confirmed: boolean, rejected: boolean): TaskContractPhase {
  if (rejected) return "rejected";
  if (contract.launchState === "launched") return "launched";
  if (confirmed) return "confirmed";
  return "draft";
}

export function canEditTaskContract(phase: TaskContractPhase): boolean {
  return phase === "draft" || phase === "rejected";
}

function substanceOf(contract: TaskContract): TaskContractSubstance {
  const {
    contractId: _contractId,
    schemaVersion: _schemaVersion,
    version: _version,
    decisionHistory: _decisionHistory,
    contentHash: _contentHash,
    launchState: _launchState,
    ...substance
  } = contract;
  return substance;
}

export async function updateTaskContractDraft(
  api: TaskContractAuthoringApi,
  contract: TaskContract,
  edits: EditableTaskContractFields,
  commandId = newId(),
): Promise<TaskContract> {
  assertNotLaunched(contract);
  const current = substanceOf(contract);
  const next: TaskContractSubstance = {
    ...current,
    ...edits,
    project: { ...current.project, ...edits.project },
    budget: { ...current.budget, ...edits.budget },
  };
  return api.updateTaskContract(
    contract.contractId,
    {
      projectId: contract.project.projectId,
      expectedVersion: contract.version,
      substance: next,
    },
    commandId,
  );
}

export async function confirmTaskContractDraft(api: TaskContractAuthoringApi, contract: TaskContract, commandId = newId()): Promise<void> {
  assertNotLaunched(contract);
  await api.confirmTaskContract(
    contract.contractId,
    {
      projectId: contract.project.projectId,
      version: contract.version,
      contentHash: contract.contentHash,
    },
    commandId,
  );
}

/** Launch is intentionally separate from confirmation; callers must invoke it explicitly. */
export async function launchTaskContractDraft(
  api: TaskContractAuthoringApi,
  contract: TaskContract,
  commandId = newId(),
): Promise<TaskContractLaunchResult> {
  assertNotLaunched(contract);
  return api.launchTaskContract(contract.contractId, contract.project.projectId, commandId);
}
