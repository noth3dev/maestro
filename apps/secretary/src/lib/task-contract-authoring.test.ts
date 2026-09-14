import { describe, expect, it, vi } from "vitest";
import { CreateTaskContractInputSchema, type TaskContract, type TaskContractSubstance } from "@carnegie/contracts";
import {
  buildTaskContractDraft,
  confirmTaskContractDraft,
  createTaskContractDraft,
  launchTaskContractDraft,
  updateTaskContractDraft,
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
    expect(api.confirmTaskContract).toHaveBeenCalledWith(contractId, { projectId, version: 1, contentHash: contract.contentHash }, commandId);
    expect(api.launchTaskContract).not.toHaveBeenCalled();

    await launchTaskContractDraft(api, contract, commandId);
    expect(api.launchTaskContract).toHaveBeenCalledWith(contractId, projectId, commandId);
  });

  it("lets the server's rejection reason reach the caller unchanged", async () => {
    const api = fakeApi();
    const rejection = new Error("Task Contract project boundary cannot change");
    vi.mocked(api.createTaskContract).mockRejectedValueOnce(rejection);

    await expect(createTaskContractDraft(api, { projectId, substance }, contractId)).rejects.toBe(rejection);
  });
});
