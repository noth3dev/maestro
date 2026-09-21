import { describe, expect, it, vi } from "vitest";
import type { MissionBundle, Worker } from "@maestro/contracts";
import {
  loadWorkerObservation,
  cancelWorkerAfterConfirmation,
  loadWorkers,
  missionBundleMatchesWorker,
  sendWorkerMessage,
  spawnWorkerFromMissionBundle,
  type WorkerApi,
} from "./worker-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const councilId = "33333333-3333-4333-8333-333333333333";
const workerId = "44444444-4444-4444-8444-444444444444";
const hash = "a".repeat(64);

const missionSubstance: MissionBundle["substance"] = {
  role: "execution",
  profileRef: "profile:engineering",
  goalBrief: "Implement the bounded hero section mission.",
  taskDemand: {
    schemaVersion: 1,
    taskKinds: ["coding"],
    requirements: {
      reasoning: { level: 1, rationale: "bounded test demand" },
      coding: { level: 1, rationale: "bounded test demand" },
      verification: { level: 1, rationale: "bounded test demand" },
      "instruction-fidelity": { level: 1, rationale: "bounded test demand" },
      "tool-use": { level: 1, rationale: "bounded test demand" },
      "long-context": { level: 1, rationale: "bounded test demand" },
      knowledge: { level: 1, rationale: "bounded test demand" },
      "refusal-calibration": { level: 1, rationale: "bounded test demand" },
    },
    provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
  },
  approvedModels: ["openai-codex/gpt-5.6-luna"],
  allowedSkills: ["testing"],
  allowedTools: ["read"],
  allowedPaths: ["/repo/marketing"],
  environment: ["test"],
  authorityBoundary: ["bounded"],
  externalServiceBoundary: ["none"],
  dataBoundary: ["workspace"],
  costCeiling: "10 cents",
  timeCeiling: "10 minutes",
  retryCeiling: 1,
  workerCeiling: 1,
  deliverable: "hero section",
  evidenceRequirements: ["test log"],
  validationCriteria: ["tests pass"],
  terminationConditions: ["deliverable complete"],
};

const worker: Worker = {
  workerId,
  councilId,
  departmentId: "engineering",
  planVersion: 2,
  itemId: "hero-section",
  bundleContentHash: hash,
  attempt: 1,
  executionRef: "execution-1",
  invocationRef: "invocation-1",
  status: "running",
  answerText: null,
  usageTotalTokens: null,
};

const missionBundle = {
  councilId,
  departmentId: "engineering",
  planVersion: 2,
  planContentHash: "b".repeat(64),
  itemId: "hero-section",
  parentRef: "department-plan:engineering:2",
  substance: missionSubstance,
  contentHash: hash,
} satisfies MissionBundle;

describe("Worker data scope", () => {
  it("reloads the selected Goal's workers through the durable list read", async () => {
    const api = { listWorkersForGoal: vi.fn().mockResolvedValue({ workers: [worker] }) } as unknown as WorkerApi;

    await expect(loadWorkers(api, goalId, projectId)).resolves.toEqual({ workers: [worker] });
    expect(api.listWorkersForGoal).toHaveBeenCalledOnce();
    expect(api.listWorkersForGoal).toHaveBeenCalledWith(goalId, { projectId });
  });

  it("rejects a Mission Bundle whose durable content identity is stale for the selected Worker", () => {
    expect(missionBundleMatchesWorker(missionBundle, worker)).toBe(true);
    expect(missionBundleMatchesWorker({ ...missionBundle, contentHash: "c".repeat(64) }, worker)).toBe(false);
    expect(missionBundleMatchesWorker({ ...missionBundle, itemId: "other-item" }, worker)).toBe(false);
  });

  it("spawns only from the server-issued Mission Bundle identity", async () => {
    const api = { spawnWorker: vi.fn().mockResolvedValue(worker) } as unknown as WorkerApi;
    const commandId = "55555555-5555-4555-8555-555555555555";

    await spawnWorkerFromMissionBundle(api, projectId, missionBundle, commandId);

    expect(api.spawnWorker).toHaveBeenCalledWith(
      councilId,
      "engineering",
      { projectId, planVersion: 2, itemId: "hero-section" },
      commandId,
    );
    await expect(spawnWorkerFromMissionBundle(api, projectId, { ...missionBundle, contentHash: "not-a-hash" } as MissionBundle, commandId)).rejects.toThrow();
    expect(api.spawnWorker).toHaveBeenCalledOnce();
  });

  it("loads the durable Worker before requesting a scoped observation", async () => {
    const observation = { ...worker, observability: { stopState: "open", capabilityJournal: [], ipythonSessionJournal: [], toolEvents: { state: "empty", events: [] } } };
    const api = {
      listWorkersForGoal: vi.fn().mockResolvedValue({ workers: [worker] }),
      getWorker: vi.fn().mockResolvedValue(worker),
      observeWorker: vi.fn().mockResolvedValue(observation),
    } as unknown as WorkerApi;
    const commandId = "66666666-6666-4666-8666-666666666666";

    await expect(loadWorkerObservation(api, workerId, { goalId, projectId, bundle: missionBundle }, commandId)).resolves.toEqual(observation);
    expect(api.getWorker).toHaveBeenCalledWith(workerId, projectId);
    expect(api.observeWorker).toHaveBeenCalledWith(workerId, { projectId }, commandId);
  });

  it("requires confirmation and refuses to pretend a terminal Worker was cancelled", async () => {
    const cancelWorker = vi.fn().mockResolvedValue({ ...worker, status: "cancelled" as const });
    const getWorker = vi.fn().mockResolvedValue(worker);
    const api = { listWorkersForGoal: vi.fn().mockResolvedValue({ workers: [worker] }), getWorker, cancelWorker } as unknown as WorkerApi;

    await expect(cancelWorkerAfterConfirmation(api, workerId, { goalId, projectId, bundle: missionBundle }, false)).rejects.toThrow("explicit confirmation");
    expect(cancelWorker).not.toHaveBeenCalled();
    await expect(cancelWorkerAfterConfirmation(api, workerId, { goalId, projectId, bundle: missionBundle }, true, "88888888-8888-4888-8888-888888888888")).resolves.toMatchObject({ status: "cancelled" });
    expect(cancelWorker).toHaveBeenCalledWith(workerId, { projectId }, "88888888-8888-4888-8888-888888888888");

    getWorker.mockResolvedValueOnce({ ...worker, status: "succeeded" as const });
    await expect(cancelWorkerAfterConfirmation(api, workerId, { goalId, projectId, bundle: missionBundle }, true)).rejects.toThrow("terminal Worker");
    getWorker.mockResolvedValueOnce({ ...worker, status: "unknown" as const });
    await expect(cancelWorkerAfterConfirmation(api, workerId, { goalId, projectId, bundle: missionBundle }, true)).rejects.toThrow("terminal Worker");
    expect(cancelWorker).toHaveBeenCalledOnce();
  });

  it("carries the selected Worker identity, project scope, and command identity in messages", async () => {
    const api = {
      listWorkersForGoal: vi.fn().mockResolvedValue({ workers: [worker] }),
      getWorker: vi.fn().mockResolvedValue(worker),
      sendWorkerMessage: vi.fn().mockResolvedValue(worker),
    } as unknown as WorkerApi;
    const commandId = "77777777-7777-4777-8777-777777777777";

    await sendWorkerMessage(api, workerId, { goalId, projectId, bundle: missionBundle }, "Please report the current evidence.", commandId);

    expect(api.sendWorkerMessage).toHaveBeenCalledWith(
      workerId,
      { projectId, message: "Please report the current evidence." },
      commandId,
    );
  });

  it("rejects a Worker action after the durable identity changes", async () => {
    const api = {
      listWorkersForGoal: vi.fn().mockResolvedValue({ workers: [worker] }),
      getWorker: vi.fn().mockResolvedValue({ ...worker, bundleContentHash: "c".repeat(64) }),
      sendWorkerMessage: vi.fn(),
    } as unknown as WorkerApi;

    await expect(sendWorkerMessage(api, workerId, { goalId, projectId, bundle: missionBundle }, "stale action")).rejects.toThrow("identity");
    expect(api.sendWorkerMessage).not.toHaveBeenCalled();
  });
});
