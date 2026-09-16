import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./agent-runtime.js";
import { createTaskContractDraftingTool, deriveTaskContractId } from "./overture-drafting-tool.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const substance = {
  desiredOutcome: "Ship the intake feature",
  userVisibleBehavior: ["An operator can submit a plain-language brief"],
  successCriteria: ["The brief produces a durable Task Contract"],
  liveEvidence: ["A persisted Task Contract row"],
  scope: ["Goal-less project-scoped intake"],
  nonGoals: ["Launching workers automatically"],
  priorities: ["Safety before speed"],
  acceptableTradeoffs: ["Ask follow-up questions when details are missing"],
  constraints: ["Do not use worker execution"],
  knownEdgeCases: ["Vague briefs require clarification"],
  project: { projectId, repository: "/repo", immutableBaseRevision: "abc123", dataBoundary: "repository files only" },
  evidenceReferences: ["conversation brief"],
  approvedPreviewReferences: [],
  expectedGroups: ["Product Group"],
  expectedDepartments: ["Product Department"],
  criticalActionExpectations: ["Require explicit launch confirmation"],
  forbiddenEffects: ["Worker spawn", "Mission Bundle creation"],
  environmentAssumptions: ["PostgreSQL is available"],
  externalServiceAssumptions: ["No external service required"],
  budget: { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["Stop at ceiling"] },
};

const context = { commandId: "command-1", turnId: "turn-1", toolCallId: "tool-1", operatorId: "22222222-2222-4222-8222-222222222222", projectId, conversationId: "33333333-3333-4333-8333-333333333333", goalId: undefined, capabilityGrant: { grantId: "grant", allowedTools: ["task-contract:create"], allowedSkills: [], modelPolicy: ["fake/model"], pathScope: [], outboundDataClasses: ["public", "workspace"], remaining: { modelTurns: 1, toolCalls: 1, childCalls: 0, outputTokens: 1000, wallTimeMs: 1000, retryCount: 0 } } } as unknown as ToolContext;

describe("Overture Task Contract drafting tool", () => {
  it("creates the full substance through the injected durable Task Contract creator", async () => {
    const create = vi.fn(async (contractId: string, input: unknown, _operator: { operatorId: string }) => ({ contractId, ...(input as { substance: object }).substance, schemaVersion: 1, version: 1, decisionHistory: [], contentHash: "a".repeat(64), launchState: "awaiting_confirmation" }));
    let observed: TaskContract | undefined;
    const tool = createTaskContractDraftingTool({ createTaskContract: create, onCreated: (contract) => { observed = contract; } });
    const result = await tool.execute({ projectId, substance }, context);
    expect(result.status).toBe("ok");
    expect(create).toHaveBeenCalledWith(deriveTaskContractId(context.commandId, context.turnId, context.toolCallId), { projectId, substance }, { operatorId: context.operatorId });
    expect(JSON.parse(result.content)).toMatchObject({ desiredOutcome: substance.desiredOutcome, project: substance.project, launchState: "awaiting_confirmation" });
    expect(observed).toMatchObject({ desiredOutcome: substance.desiredOutcome, launchState: "awaiting_confirmation" });
  });

  it("binds repeated identical tool proposals to one durable idempotency identity", async () => {
    const durable = new Map<string, object>();
    const create = vi.fn(async (contractId: string, input: unknown) => {
      const existing = durable.get(contractId);
      if (existing !== undefined) return existing;
      const created = { contractId, ...(input as { substance: object }).substance, schemaVersion: 1, version: 1, decisionHistory: [], contentHash: "a".repeat(64), launchState: "awaiting_confirmation" as const };
      durable.set(contractId, created);
      return created;
    });
    const tool = createTaskContractDraftingTool({ createTaskContract: create });
    await tool.execute({ projectId, substance }, context);
    await tool.execute({ projectId, substance }, context);
    expect(create).toHaveBeenCalledTimes(2);
    expect(new Set(create.mock.calls.map(([contractId]) => contractId))).toHaveLength(1);
    expect(durable).toHaveLength(1);
  });

  it("returns an honest clarification for a vague brief without creating a contract", async () => {
    const create = vi.fn();
    const tool = createTaskContractDraftingTool({ createTaskContract: create });
    const result = await tool.execute({ projectId, brief: "make it better" }, context);
    expect(result.status).toBe("ok");
    expect(result.content.toLowerCase()).toContain("clarif");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a goal-bound context and never widens the authority boundary", async () => {
    const tool = createTaskContractDraftingTool({ createTaskContract: vi.fn() });
    await expect(tool.execute({ projectId, substance }, { ...context, goalId: "44444444-4444-4444-8444-444444444444" })).rejects.toThrow("goal-less");
    expect(tool.name).toBe("task-contract:create");
    expect(tool.description).not.toMatch(/worker|mission bundle|authorizedeffectexecutor/i);
  });
});
