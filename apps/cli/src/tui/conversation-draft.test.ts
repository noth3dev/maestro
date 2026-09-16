import { describe, expect, it } from "vitest";
import type { TaskContract } from "@maestro/contracts";
import { priorTaskContractDraft, taskContractDraftForConversation } from "./conversation-draft.js";

const project = {
  projectId: "11111111-1111-4111-8111-111111111111",
  repository: "/repo",
  immutableBaseRevision: "base",
  dataBoundary: "project only",
};
const budget = { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["Stop at ceiling"] };
const firstDraft: TaskContract = {
  contractId: "33333333-3333-4333-8333-333333333333",
  schemaVersion: 1,
  version: 1,
  desiredOutcome: "First",
  userVisibleBehavior: ["First"],
  successCriteria: ["First"],
  liveEvidence: ["First"],
  scope: ["Project"],
  nonGoals: ["None"],
  priorities: ["Safety"],
  acceptableTradeoffs: ["Ask"],
  constraints: ["No execution"],
  knownEdgeCases: ["None"],
  project,
  evidenceReferences: ["Brief"],
  approvedPreviewReferences: [],
  expectedGroups: [],
  expectedDepartments: [],
  criticalActionExpectations: ["Confirm"],
  forbiddenEffects: ["None"],
  environmentAssumptions: ["Control Plane"],
  externalServiceAssumptions: [],
  budget,
  decisionHistory: [],
  contentHash: "a".repeat(64),
  launchState: "awaiting_confirmation",
};
const latestDraft: TaskContract = {
  ...firstDraft,
  contractId: "44444444-4444-4444-8444-444444444444",
  version: 2,
  desiredOutcome: "Latest",
  contentHash: "b".repeat(64),
};
describe("conversation draft projection", () => {
  it("keeps goal-bound conversations from projecting drafts", () => {
    expect(taskContractDraftForConversation(JSON.stringify(latestDraft), "goal-1")).toBeUndefined();
  });

  it("finds the latest valid assistant draft without mutating messages", () => {
    const messages = [
      { role: "assistant" as const, content: JSON.stringify(firstDraft) },
      { role: "user" as const, content: JSON.stringify(latestDraft) },
      { role: "assistant" as const, content: "not a draft" },
      { role: "assistant" as const, content: JSON.stringify(latestDraft) },
    ];
    const snapshot = [...messages];

    expect(priorTaskContractDraft(messages, undefined)).toEqual(latestDraft);
    expect(messages).toEqual(snapshot);
  });
});
