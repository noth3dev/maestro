import { describe, expect, it } from "vitest";
import type { TaskContract } from "@maestro/contracts";
import {
  buildConversationInput,
  extractTaskContractDraft,
  renderTaskContractDraft,
  retainDraftAfterDecision,
  type GoalLessDraftState,
} from "./goal-less-intake.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const contract: TaskContract = {
  contractId: "33333333-3333-4333-8333-333333333333",
  schemaVersion: 1,
  version: 1,
  desiredOutcome: "Ship the intake",
  userVisibleBehavior: ["A brief is accepted"],
  successCriteria: ["A durable contract exists"],
  liveEvidence: ["Contract row"],
  scope: ["Project only"],
  nonGoals: ["No workers yet"],
  priorities: ["Safety"],
  acceptableTradeoffs: ["Ask when unclear"],
  constraints: ["No execution before approval"],
  knownEdgeCases: ["Vague brief"],
  project: { projectId, repository: "/repo", immutableBaseRevision: "abc", dataBoundary: "project only" },
  evidenceReferences: ["brief"],
  approvedPreviewReferences: [],
  expectedGroups: [],
  expectedDepartments: [],
  criticalActionExpectations: ["Explicit confirmation"],
  forbiddenEffects: ["Worker spawn"],
  environmentAssumptions: ["Control Plane"],
  externalServiceAssumptions: [],
  budget: { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["Stop at ceiling"] },
  decisionHistory: [],
  contentHash: "a".repeat(64),
  launchState: "awaiting_confirmation",
};

describe("goal-less TUI intake", () => {
  it("sends null Goal for a goal-less conversation and preserves an attached Goal", () => {
    expect(buildConversationInput(projectId, undefined, "openai/gpt-5")).toEqual({ projectId, goalId: null, model: "openai/gpt-5" });
    expect(buildConversationInput(projectId, goalId, "openai/gpt-5")).toEqual({ projectId, goalId, model: "openai/gpt-5" });
  });

  it("extracts a complete durable Task Contract from plain or fenced assistant output", () => {
    expect(extractTaskContractDraft(JSON.stringify(contract))).toEqual(contract);
    expect(
      extractTaskContractDraft(`Here is the draft:
\`\`\`json
${JSON.stringify(contract, null, 2)}
\`\`\``),
    ).toEqual(contract);
  });

  it("renders every contract field and separates review from confirmation and launch", () => {
    const rendered = renderTaskContractDraft(contract).join("\n");
    expect(rendered).toContain("Task Contract draft · awaiting_confirmation");
    expect(rendered).toContain('"desiredOutcome": "Ship the intake"');
    expect(rendered).toContain('"forbiddenEffects": [');
    expect(rendered).toContain("/task-contract confirm");
    expect(rendered).toContain("/task-contract launch");
    expect(rendered.indexOf("/task-contract confirm")).toBeLessThan(rendered.indexOf("/task-contract launch"));
  });

  it("keeps a declined or revised draft available for continued conversation", () => {
    const state: GoalLessDraftState = { draft: contract, status: "review" };
    expect(retainDraftAfterDecision(state, "decline")).toEqual({ draft: contract, status: "declined" });
    expect(retainDraftAfterDecision(state, "revise")).toEqual({ draft: contract, status: "revising" });
  });
});
