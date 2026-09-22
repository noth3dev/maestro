import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionKernelPort } from "@maestro/domain";
import { SpawnWorkerInputSchema } from "@maestro/contracts";
import type { Pool } from "pg";
import type { MaestroConfig } from "./config.js";
import type { WorkerAdmissionFactoryInput } from "@maestro/persistence";

const persistenceMocks = vi.hoisted(() => ({
  assertProjectRole: vi.fn(),
  readDepartmentPlan: vi.fn(),
  readHeadCouncil: vi.fn(),
  readRoutingWorkSnapshot: vi.fn(),
  spawnWorker: vi.fn(),
}));
const compositionMocks = vi.hoisted(() => ({
  createEnsembleNativeAdmission: vi.fn(),
  readRoutingCandidateCatalog: vi.fn(),
}));

vi.mock("@maestro/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@maestro/persistence")>()),
  ...persistenceMocks,
}));
vi.mock("./ensemble-admission.js", () => ({ createEnsembleNativeAdmission: compositionMocks.createEnsembleNativeAdmission }));
vi.mock("./ensemble-candidate-catalog.js", () => ({ readRoutingCandidateCatalog: compositionMocks.readRoutingCandidateCatalog }));

import { assertProjectRole, readDepartmentPlan, readHeadCouncil, spawnWorker } from "@maestro/persistence";
import { composeExecutionServices } from "./composition/execution-services.js";
import {
  EnsembleRoutingUnavailableError,
  assertWorkerRoutingMode,
  createWorkerService,
  resolveWorkerModelForRouting,
} from "./worker-service.js";

describe("worker routing mode guard", () => {
  it("fails closed before worker admission while ensemble routing is not composed", () => {
    expect(() => assertWorkerRoutingMode("ensemble")).toThrow(EnsembleRoutingUnavailableError);
  });

  it("leaves explicit pin mode available to the existing native path", () => {
    expect(() => assertWorkerRoutingMode("pin")).not.toThrow();
    expect(resolveWorkerModelForRouting("pin", "test/model-a", undefined)).toBe("test/model-a");
    expect(() => resolveWorkerModelForRouting("pin", "test/model-a", "other/model")).toThrow("pin identity");
    expect(resolveWorkerModelForRouting("ensemble", undefined, undefined, true)).toBeUndefined();
    expect(() => resolveWorkerModelForRouting("ensemble", undefined, "caller/model", true)).toThrow(/caller-selected/i);
  });

  it("blocks the production Worker service before any provider admission in ensemble mode", async () => {
    const kernel = { spawn: vi.fn() } as unknown as ExecutionKernelPort;
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{}] })) } as unknown as Pool;
    const service = createWorkerService({ modelRoutingMode: "ensemble", pool, kernel, withGoalLease: vi.fn() });
    await expect(
      service.spawn(
        "council-1",
        "coding",
        { projectId: "00000000-0000-4000-8000-000000000001", planVersion: 1, itemId: "item-1" },
        "command-1",
        { operatorId: "operator-1" },
      ),
    ).rejects.toBeInstanceOf(EnsembleRoutingUnavailableError);
    expect(kernel.spawn).not.toHaveBeenCalled();
  });
});


describe("worker admission identity seam", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const proof = { goalId: "goal-1", ownerId: "owner-1", fencingToken: "1" };
  const council = {
    goalId: proof.goalId,
    snapshot: {
      projectId,
      participants: [{ departmentId: "product", participantId: "participant:product", headRoleId: "head:product", sessionRef: "session:product" }],
      contract: { content: { project: { repository: "repo" } } },
    },
  };
  const plan = { projectId, version: 1 };
  const worker = {
    workerId: "worker-1", councilId: "council-1", departmentId: "product", planVersion: 1, itemId: "item-1",
    bundleContentHash: "hash", attempt: 1, executionRef: "execution-1", invocationRef: "invocation-1", status: "spawned",
    answerText: null, usageTotalTokens: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertProjectRole).mockResolvedValue(undefined);
    vi.mocked(readHeadCouncil).mockResolvedValue(council as never);
    vi.mocked(readDepartmentPlan).mockResolvedValue(plan as never);
    vi.mocked(spawnWorker).mockResolvedValue(worker as never);
  });

  it("passes the authenticated operator identity to persistence without replacing the Head actor", async () => {
    const admission = vi.fn();
    const service = createWorkerService({
      modelRoutingMode: "ensemble",
      createEnsembleAdmission: admission,
      pool: {} as Pool,
      kernel: { spawn: vi.fn() } as unknown as ExecutionKernelPort,
      withGoalLease: vi.fn(async (_goal, operation) => operation(proof)),
    });

    await service.spawn(
      "council-1",
      "product",
      { projectId, planVersion: 1, itemId: "item-1" },
      "command-1",
      { operatorId: "authenticated-operator", credentialId: "credential-1" },
    );

    expect(spawnWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ operatorId: "authenticated-operator", createAdmission: admission }),
      proof,
      expect.objectContaining({ actorId: "head:product", sessionRef: "session:product" }),
    );
  });

  it("reads the operator model pool for every composed ensemble admission", async () => {
    let poolRead = 0;
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT model_pool FROM operator_settings")) {
          const enabledModelRefs = poolRead++ === 0 ? ["openai/model-strong"] : ["openai/model-fast"];
          return { rowCount: 1, rows: [{ model_pool: { enabledModelRefs } }] };
        }
        return { rowCount: 0, rows: [] };
      }),
    } as unknown as Pool;
    const config = {
      modelRoutingMode: "ensemble",
      ensembleCandidateCatalogPath: "/tmp/candidates.json",
      worktreeRoot: "/workspace",
    } as unknown as MaestroConfig;
    const admissionDecision = {} as never;
    persistenceMocks.readRoutingWorkSnapshot.mockResolvedValue({} as never);
    compositionMocks.readRoutingCandidateCatalog.mockReturnValue({ modelMap: {}, candidates: [] });
    compositionMocks.createEnsembleNativeAdmission.mockReturnValue(admissionDecision);

    const services = composeExecutionServices({
      pool,
      config,
      overrides: {},
      withGoalLease: vi.fn(async (_goal, operation) => operation(proof)),
      executionKernel: { spawn: vi.fn() } as unknown as ExecutionKernelPort,
      authorityExecutor: {} as never,
    });
    await services.workerService.spawn(
      "council-1",
      "product",
      { projectId, planVersion: 1, itemId: "item-1" },
      "command-1",
      { operatorId: "authenticated-operator" },
    );

    const request = vi.mocked(spawnWorker).mock.calls[0]?.[2];
    expect(request?.createAdmission).toBeTypeOf("function");
    const admissionInput = {
      operatorId: "authenticated-operator",
      workerId: "worker-1",
      routeRef: "worker:worker-1:1",
      bundle: { councilId: "council-1", departmentId: "product", planVersion: 1, itemId: "item-1" },
      base: { context: { goalId: proof.goalId, projectId, missionBundleId: "bundle-1" } },
    } as unknown as WorkerAdmissionFactoryInput;
    await request!.createAdmission!(admissionInput);
    await request!.createAdmission!(admissionInput);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining("SELECT model_pool FROM operator_settings"), ["authenticated-operator"]);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining("SELECT model_pool FROM operator_settings"), ["authenticated-operator"]);
    expect(compositionMocks.createEnsembleNativeAdmission).toHaveBeenNthCalledWith(
      1,
      config,
      expect.objectContaining({ operatorEnabledModelRefs: ["openai/model-strong"] }),
    );
    expect(compositionMocks.createEnsembleNativeAdmission).toHaveBeenNthCalledWith(
      2,
      config,
      expect.objectContaining({ operatorEnabledModelRefs: ["openai/model-fast"] }),
    );
  });
});


describe("target-bound worker lifecycle", () => {
  it("accepts a declared repository and worktree path for target-scoped spawn", () => {
    const parsed = SpawnWorkerInputSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001", planVersion: 1, itemId: "repair",
      repositoryPath: "/workspace/project", worktreePath: "/workspace/workers/repair",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a partial target binding instead of allowing a later worktree", () => {
    expect(SpawnWorkerInputSchema.safeParse({ projectId: "00000000-0000-4000-8000-000000000001", planVersion: 1, itemId: "repair", repositoryPath: "/workspace/project" }).success).toBe(false);
  });

  it("exposes a worker follow-up message operation", () => {
    const kernel = { spawn: vi.fn() } as unknown as ExecutionKernelPort;
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{}] })) } as unknown as Pool;
    const service = createWorkerService({ modelRoutingMode: "pin", nativeModelRef: "test/model-a", pool, kernel, withGoalLease: vi.fn() });
    expect("sendMessage" in service).toBe(true);
  });

});
