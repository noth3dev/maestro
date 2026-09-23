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
  canEditTaskContract,
  ConversationTurnError,
  getTaskContractPhase,
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
    launchTaskContract: vi.fn().mockResolvedValue({ taskContract: { ...contract, launchState: "launched" }, goalId: contractId, scheduling: "queued" as const }),
  };
}

describe("task contract authoring", () => {
  it("creates a new Concertmaster conversation with the selected live model", async () => {
    const api = {
      listModels: vi.fn(async () => [
        { identity: { provider: "openai-codex", id: "gpt-a" }, capabilities: ["text"], authModes: ["managed-subscription"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } },
        { identity: { provider: "openai-codex", id: "gpt-b" }, capabilities: ["text"], authModes: ["managed-subscription"], reasoningEfforts: { supported: ["low", "high"], default: "high" }, dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } },
      ]),
      createConversation: vi.fn(async () => ({ conversationId: "44444444-4444-4444-8444-444444444444", projectId, goalId: null, model: "openai-codex/gpt-b", status: "active" as const, version: 1 })),
      sendConversationTurn: vi.fn(async () => ({ conversation: { conversationId: "44444444-4444-4444-8444-444444444444", projectId, goalId: null, model: "openai-codex/gpt-b", status: "succeeded" as const, version: 2 }, turn: { turnId: "55555555-5555-4555-8555-555555555555", conversationId: "44444444-4444-4444-8444-444444444444", role: "assistant" as const, content: "selected", status: "completed" as const, cursor: "1", createdAt: "2026-09-16T00:00:00.000Z" } })),
    };
    await submitHomeBrief(api, { projectId, text: "use the selected model", selectedGoalId: undefined, modelRef: "openai-codex/gpt-b", reasoningEffort: "low" });
    expect(api.createConversation).toHaveBeenCalledWith({ projectId, goalId: null, model: "openai-codex/gpt-b", reasoningEffort: "low" }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

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

  it("sends a no-Goal Home brief through the durable Concertmaster conversation without creating a draft", async () => {
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
          content: "I can help you think through that request.",
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
    expect(result.response).toBe("I can help you think through that request.");
    expect(result.draft).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("publishes the conversation identity before a slow turn finishes", async () => {
    const conversationId = "44444444-4444-4444-8444-444444444444";
    const turnResult = {
      conversation: { conversationId, projectId, goalId: null, model: "openai/gpt-5", status: "succeeded" as const, version: 2 },
      turn: { turnId: "55555555-5555-4555-8555-555555555555", conversationId, role: "assistant" as const, content: "done", status: "completed" as const, cursor: "1", createdAt: "2026-09-16T00:00:00.000Z" },
    };
    let release!: (value: typeof turnResult) => void;
    let markTurnStarted!: () => void;
    const turnStarted = new Promise<void>((resolve) => { markTurnStarted = resolve; });
    const api = {
      listModels: vi.fn(async () => [{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } }]),
      createConversation: vi.fn(async () => ({ conversationId, projectId, goalId: null, model: "openai/gpt-5", status: "active" as const, version: 1 })),
      sendConversationTurn: vi.fn(() => {
        markTurnStarted();
        return new Promise<typeof turnResult>((resolve) => { release = resolve; });
      }),
    };
    const identities: string[] = [];
    const pending = submitHomeBrief(api, { projectId, text: "slow request", selectedGoalId: undefined, onConversationCreated: (id) => identities.push(id) });
    await turnStarted;
    expect(identities).toEqual([conversationId]);
    release(turnResult);
    await pending;
  });

  it("keeps the created conversation identity when a real turn fails", async () => {
    const conversationId = "44444444-4444-4444-8444-444444444444";
    const api = {
      listModels: vi.fn(async () => [{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } }]),
      createConversation: vi.fn(async () => ({ conversationId, projectId, goalId: null, model: "openai/gpt-5", status: "active" as const, version: 1 })),
      sendConversationTurn: vi.fn(async () => { throw new Error("provider unavailable"); }),
    };

    const failure = await submitHomeBrief(api, { projectId, text: "retry this safely", selectedGoalId: undefined }).catch((cause) => cause);
    expect(failure).toBeInstanceOf(ConversationTurnError);
    expect(failure).toMatchObject({ conversationId });
  });

  it("preserves failed, cancelled, and unknown turn outcomes for Home status", async () => {
    for (const status of ["failed", "cancelled", "unknown"] as const) {
      const api = {
        listModels: vi.fn(async () => [{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } }]),
        createConversation: vi.fn(async () => ({ conversationId: "44444444-4444-4444-8444-444444444444", projectId, goalId: null, model: "openai/gpt-5", status: "active" as const, version: 1 })),
        sendConversationTurn: vi.fn(async () => ({ conversation: { conversationId: "44444444-4444-4444-8444-444444444444", projectId, goalId: null, model: "openai/gpt-5", status, version: 2 }, turn: { turnId: "55555555-5555-4555-8555-555555555555", conversationId: "44444444-4444-4444-8444-444444444444", role: "assistant" as const, content: `${status} turn`, status, cursor: "1", createdAt: "2026-09-16T00:00:00.000Z" } })),
      };

      const result = await submitHomeBrief(api, { projectId, text: "bounded request", selectedGoalId: undefined });
      expect(result.turnStatus).toBe(status);
    }
  });

  it("creates one no-Goal conversation and sends later turns with fresh idempotency keys", async () => {
    const api = {
      listModels: vi.fn(async () => [{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } }]),
      createConversation: vi.fn(async () => ({ conversationId: "44444444-4444-4444-8444-444444444444", projectId, goalId: null, model: "openai/gpt-5", status: "active" as const, version: 1 })),
      sendConversationTurn: vi.fn(async () => ({ conversation: { conversationId: "44444444-4444-4444-8444-444444444444", projectId, goalId: null, model: "openai/gpt-5", status: "succeeded" as const, version: 2 }, turn: { turnId: "55555555-5555-4555-8555-555555555555", conversationId: "44444444-4444-4444-8444-444444444444", role: "assistant" as const, content: "first response", status: "completed" as const, cursor: "1", createdAt: "2026-09-16T00:00:00.000Z" } })),
    };

    const first = await submitHomeBrief(api, { projectId, text: "first turn", selectedGoalId: undefined });
    const second = await submitHomeBrief(api, { projectId, text: "follow-up turn", selectedGoalId: undefined, conversationId: first.conversationId });

    expect(api.createConversation).toHaveBeenCalledTimes(1);
    expect(api.sendConversationTurn).toHaveBeenCalledTimes(2);
    const firstKey = vi.mocked(api.sendConversationTurn).mock.calls[0]?.[2].idempotencyKey;
    const secondKey = vi.mocked(api.sendConversationTurn).mock.calls[1]?.[2].idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toEqual(expect.any(String));
    expect(secondKey).not.toBe(firstKey);
    expect(second.response).toBe("first response");
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
    expect(result.response).toContain("desired outcome");
    expect(result.message).toBeUndefined();
  });

  it("keeps Home conversational when a Goal is selected", async () => {
    const conversationId = "44444444-4444-4444-8444-444444444444";
    const api = {
      ...fakeApi(),
      listModels: vi.fn(async () => [
        {
          identity: { provider: "openai", id: "gpt-5" },
          capabilities: ["text"],
          authModes: ["api-key"],
          dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] },
        },
      ]),
      createConversation: vi.fn(async () => ({
        conversationId,
        projectId,
        goalId: contract.project.projectId,
        model: "openai/gpt-5",
        status: "active" as const,
        version: 1,
      })),
      sendConversationTurn: vi.fn(async () => ({
        conversation: {
          conversationId,
          projectId,
          goalId: contract.project.projectId,
          model: "openai/gpt-5",
          status: "succeeded" as const,
          version: 2,
        },
        turn: {
          turnId: "55555555-5555-4555-8555-555555555555",
          conversationId,
          role: "assistant" as const,
          content: "I will help with the selected Goal.",
          status: "completed" as const,
          cursor: "1",
          createdAt: "2026-09-16T00:00:00.000Z",
        },
      })),
    };

    const result = await submitHomeBrief(api, {
      projectId,
      text: "Ship the pricing copy safely",
      selectedGoalId: contract.project.projectId,
    });

    expect(api.createConversation).toHaveBeenCalledWith(
      { projectId, goalId: contract.project.projectId, model: "openai/gpt-5" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(api.createTaskContract).not.toHaveBeenCalled();
    expect(result.response).toBe("I will help with the selected Goal.");
    expect(result.draft).toBeUndefined();
  });



  it("exposes the explicit draft safety phases", () => {
    expect(getTaskContractPhase(contract, false, false)).toBe("draft");
    expect(getTaskContractPhase(contract, true, false)).toBe("confirmed");
    expect(canEditTaskContract(getTaskContractPhase(contract, true, false))).toBe(false);
    expect(getTaskContractPhase({ ...contract, launchState: "launched" }, true, false)).toBe("launched");
    expect(canEditTaskContract(getTaskContractPhase({ ...contract, launchState: "launched" }, true, false))).toBe(false);
    expect(getTaskContractPhase(contract, false, true)).toBe("rejected");
    expect(canEditTaskContract(getTaskContractPhase(contract, false, true))).toBe(true);
  });

  it("rejects editing, confirming, or launching a contract that is already launched", async () => {
    const api = fakeApi();
    const launched = { ...contract, launchState: "launched" as const };

    await expect(updateTaskContractDraft(api, launched, { desiredOutcome: "too late" })).rejects.toThrow("already launched");
    await expect(confirmTaskContractDraft(api, launched)).rejects.toThrow("already launched");
    await expect(launchTaskContractDraft(api, launched)).rejects.toThrow("already launched");
    expect(api.updateTaskContract).not.toHaveBeenCalled();
    expect(api.confirmTaskContract).not.toHaveBeenCalled();
    expect(api.launchTaskContract).not.toHaveBeenCalled();
  });

  it("preserves stale-version and launch failures without inventing success", async () => {
    const api = fakeApi();
    const stale = new Error("version conflict");
    vi.mocked(api.updateTaskContract).mockRejectedValueOnce(stale);
    await expect(updateTaskContractDraft(api, contract, { desiredOutcome: "stale edit" })).rejects.toBe(stale);

    const launchFailure = new Error("launch rejected");
    vi.mocked(api.launchTaskContract).mockRejectedValueOnce(launchFailure);
    await expect(launchTaskContractDraft(api, contract)).rejects.toBe(launchFailure);
  });

  it("lets the server's rejection reason reach the caller unchanged", async () => {
    const api = fakeApi();
    const rejection = new Error("Task Contract project boundary cannot change");
    vi.mocked(api.createTaskContract).mockRejectedValueOnce(rejection);

    await expect(createTaskContractDraft(api, { projectId, substance }, contractId)).rejects.toBe(rejection);
  });
});
