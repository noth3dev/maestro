import { describe, expect, it, vi } from "vitest";
import { CreateTaskContractInputSchema, type TaskContract, type TaskContractSubstance } from "@maestro/contracts";
import {
  buildTaskContractDraft,
  confirmTaskContractDraft,
  createTaskContractDraft,
  launchTaskContractDraft,
  updateTaskContractDraft,
  submitHomeBrief,
  formatTaskContractReview,
  type TaskContractAuthoringApi,
} from "./task-contract-authoring.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const contractId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";

const substance: TaskContractSubstance = buildTaskContractDraft(projectId, "Ship the pricing copy safely");
const contract: TaskContract = {
  ...substance,
  contractId,
  schemaVersion: 1,
  version: 1,
  decisionHistory: [],
  contentHash: "a".repeat(64),
  launchState: "awaiting_confirmation",
};

function fakeApi(): TaskContractAuthoringApi {
  return {
    createTaskContract: vi.fn().mockResolvedValue(contract),
    getTaskContract: vi.fn(),
    updateTaskContract: vi.fn().mockResolvedValue({ ...contract, version: 2, desiredOutcome: "Updated outcome" }),
    confirmTaskContract: vi.fn().mockResolvedValue(undefined),
    launchTaskContract: vi.fn().mockResolvedValue({ ...contract, launchState: "launched" }),
  };
}

describe("task contract authoring", () => {
  it("turns a brief into a schema-valid project-bound draft", () => {
    const draft = buildTaskContractDraft(projectId, "  Ship the pricing copy safely  ");

    expect(CreateTaskContractInputSchema.parse({ projectId, substance: draft })).toEqual({ projectId, substance: draft });
    expect(draft.desiredOutcome).toBe("Ship the pricing copy safely");
    expect(draft.project.projectId).toBe(projectId);
  });

  it("persists a draft through the same create API without launching it", async () => {
    const api = fakeApi();

    const saved = await createTaskContractDraft(api, { projectId, substance }, contractId);

    expect(api.createTaskContract).toHaveBeenCalledWith({ projectId, substance }, contractId);
    expect(api.launchTaskContract).not.toHaveBeenCalled();
    expect(saved).toEqual(contract);
  });

  it("amends the visible draft using the exact durable version returned by the server", async () => {
    const api = fakeApi();

    const updated = await updateTaskContractDraft(api, contract, { desiredOutcome: "Updated outcome" }, commandId);

    expect(api.updateTaskContract).toHaveBeenCalledWith(
      contractId,
      { projectId, expectedVersion: 1, substance: { ...substance, desiredOutcome: "Updated outcome" } },
      commandId,
    );
    expect(updated.version).toBe(2);
  });

  it("keeps confirmation and launch as two explicit calls", async () => {
    const api = fakeApi();

    await confirmTaskContractDraft(api, contract, commandId);
    expect(api.confirmTaskContract).toHaveBeenCalledWith(
      contractId,
      { projectId, version: 1, contentHash: contract.contentHash },
      commandId,
    );
    expect(api.launchTaskContract).not.toHaveBeenCalled();

    await launchTaskContractDraft(api, contract, commandId);
    expect(api.launchTaskContract).toHaveBeenCalledWith(contractId, projectId, commandId);
  });

  it("formats every Task Contract field for visible pre-confirmation review", () => {
    const review = formatTaskContractReview(contract);

    expect(review).toContain('"nonGoals"');
    expect(review).toContain('"forbiddenEffects"');
    expect(review).toContain('"budget"');
    expect(review).toContain('"externalServiceAssumptions"');
  });

  it("sends a no-Goal Home brief through the durable conversation intake and returns the reviewed draft", async () => {
    const api = {
      listModels: vi.fn(async () => [
        {
          identity: { provider: "openai", id: "gpt-5" },
          capabilities: ["text"],
          authModes: ["api-key"],
          dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] },
        },
      ]),
      createConversation: vi.fn(async () => ({
        conversationId: "44444444-4444-4444-8444-444444444444",
        projectId,
        goalId: null,
        model: "openai/gpt-5",
        status: "active" as const,
        version: 1,
      })),
      sendConversationTurn: vi.fn(async () => ({
        conversation: {
          conversationId: "44444444-4444-4444-8444-444444444444",
          projectId,
          goalId: null,
          model: "openai/gpt-5",
          status: "succeeded" as const,
          version: 2,
        },
        turn: {
          turnId: "55555555-5555-4555-8555-555555555555",
          conversationId: "44444444-4444-4444-8444-444444444444",
          role: "assistant" as const,
          content: JSON.stringify(contract),
          status: "completed" as const,
          cursor: "1",
          createdAt: "2026-09-16T00:00:00.000Z",
        },
      })),
    };

    const result = await submitHomeBrief(api, { projectId, text: "Ship the pricing copy safely", selectedGoalId: undefined });

    expect(api.createConversation).toHaveBeenCalledWith(
      { projectId, goalId: null, model: "openai/gpt-5" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(api.sendConversationTurn).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      { projectId, text: "Ship the pricing copy safely" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(result.draft).toEqual(contract);
  });

  it("keeps a clarification response reviewable without fabricating a Task Contract", async () => {
    const api = {
      listModels: vi.fn(async () => [
        {
          identity: { provider: "openai", id: "gpt-5" },
          capabilities: ["text"],
          authModes: ["api-key"],
          dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] },
        },
      ]),
      createConversation: vi.fn(async () => ({
        conversationId: "44444444-4444-4444-8444-444444444444",
        projectId,
        goalId: null,
        model: "openai/gpt-5",
        status: "active" as const,
        version: 1,
      })),
      sendConversationTurn: vi.fn(async () => ({
        conversation: {
          conversationId: "44444444-4444-4444-8444-444444444444",
          projectId,
          goalId: null,
          model: "openai/gpt-5",
          status: "succeeded" as const,
          version: 2,
        },
        turn: {
          turnId: "55555555-5555-4555-8555-555555555555",
          conversationId: "44444444-4444-4444-8444-444444444444",
          role: "assistant" as const,
          content: "Please tell me the desired outcome and budget ceiling.",
          status: "completed" as const,
          cursor: "1",
          createdAt: "2026-09-16T00:00:00.000Z",
        },
      })),
    };

    const result = await submitHomeBrief(api, { projectId, text: "help", selectedGoalId: undefined });

    expect(result.draft).toBeUndefined();
    expect(result.message).toContain("desired outcome");
  });

  it("routes Home with an attached Goal through its existing direct authoring path", async () => {
    const api = { ...fakeApi(), listModels: vi.fn(), createConversation: vi.fn(), sendConversationTurn: vi.fn() };

    const result = await submitHomeBrief(api, {
      projectId,
      text: "Ship the pricing copy safely",
      selectedGoalId: contract.project.projectId,
    });

    expect(api.createTaskContract).toHaveBeenCalledOnce();
    expect(api.createConversation).not.toHaveBeenCalled();
    expect(result.draft).toEqual(contract);
  });

  it("lets the server's rejection reason reach the caller unchanged", async () => {
    const api = fakeApi();
    const rejection = new Error("Task Contract project boundary cannot change");
    vi.mocked(api.createTaskContract).mockRejectedValueOnce(rejection);

    await expect(createTaskContractDraft(api, { projectId, substance }, contractId)).rejects.toBe(rejection);
  });
});
