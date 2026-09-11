import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExecutionKernelPort } from "@maestro/domain";
import type { Pool } from "pg";
import { createWorkerService } from "./worker-service.js";
import { LeaseUnavailableError } from "@maestro/persistence";
import { assertProjectRole, claimQueuedCapacity, listCapacityInventoryProjects, readDepartmentPlan, readHeadCouncil, spawnWorker } from "@maestro/persistence";

vi.mock("@maestro/persistence", async (load) => {
  const actual = await load<typeof import("@maestro/persistence")>();
  return { ...actual, assertProjectRole: vi.fn(), claimQueuedCapacity: vi.fn(), listCapacityInventoryProjects: vi.fn(), readDepartmentPlan: vi.fn(), readHeadCouncil: vi.fn(), spawnWorker: vi.fn() };
});

const projectId = "00000000-0000-4000-8000-000000000001";
const goalId = "00000000-0000-4000-8000-000000000002";
const proof = { goalId, ownerId: "owner", fencingToken: "1" };
const council = { goalId, snapshot: { projectId, participants: [{ departmentId: "coding", participantId: "participant", headRoleId: "head", sessionRef: "session" }], contract: { content: { project: { repository: "/workspace/project" } } } } } as never;
const plan = { projectId, version: 1 } as never;
const worker = { workerId: "00000000-0000-4000-8000-000000000003", councilId: "council", departmentId: "coding", planVersion: 1, itemId: "item", bundleContentHash: "hash", attempt: 1, executionRef: "exec", invocationRef: "inv", status: "spawned", answerText: null, usageTotalTokens: null } as never;
const baseDeps = () => ({ modelRoutingMode: "pin" as const, nativeModelRef: "test/model", pool: {} as Pool, kernel: { spawn: vi.fn() } as unknown as ExecutionKernelPort, withGoalLease: vi.fn(async (_goal: string, operation: (proof: typeof proof) => Promise<unknown>) => operation(proof)) });

describe("worker capacity admission", () => {
  beforeEach(() => { vi.mocked(assertProjectRole).mockResolvedValue(undefined); vi.mocked(readHeadCouncil).mockResolvedValue(council); vi.mocked(readDepartmentPlan).mockResolvedValue(plan); vi.mocked(spawnWorker).mockResolvedValue(worker); });
  it("returns a queued admission without calling provider or worker persistence", async () => {
    const deps = baseDeps(); const reserve = vi.fn().mockResolvedValue({ kind: "queued", queueId: "queue-1", reason: "worker_slots" as const });
    const service = createWorkerService({ ...deps, capacity: { reserve, release: vi.fn(), requeue: vi.fn() } });
    const result = await service.spawn("council", "coding", { projectId, planVersion: 1, itemId: "item" }, "00000000-0000-4000-8000-000000000004", { operatorId: "operator" });
    expect(result).toMatchObject({ kind: "queued", queueId: "queue-1", requirement: "medium", pressure: "normal" });
    expect(deps.kernel.spawn).not.toHaveBeenCalled(); expect(spawnWorker).not.toHaveBeenCalled();
  });
  it("drains a claimed queued admission through the WorkerService provider path", async () => {
    vi.mocked(listCapacityInventoryProjects).mockResolvedValue([projectId]);
    vi.mocked(claimQueuedCapacity).mockResolvedValue([{ reservationId: "reservation-1", status: "reserved", queuedAt: 1, createdAt: new Date(), goalId, projectId, commandId: "00000000-0000-4000-8000-000000000004", providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high", pressure: "elevated", admission: { councilId: "council", departmentId: "coding", planVersion: 1, itemId: "item", operatorId: "operator", credentialId: "credential" } }]);
    const deps = baseDeps(); const reserve = vi.fn().mockResolvedValue({ kind: "reserved", reservationId: "reservation-1" }); const service = createWorkerService({ ...deps, capacity: { reserve, release: vi.fn(), requeue: vi.fn() } });
    await service.drainCapacityQueues?.();
    expect(spawnWorker).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high", pressure: "elevated" }), expect.anything());
  });

  it("requeues a claimed admission when the Goal lease is temporarily unavailable", async () => {
    vi.mocked(listCapacityInventoryProjects).mockResolvedValue([projectId]);
    vi.mocked(claimQueuedCapacity).mockResolvedValue([{ reservationId: "reservation-1", status: "reserved", queuedAt: 1, createdAt: new Date(), goalId, projectId, commandId: "00000000-0000-4000-8000-000000000004", providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high", pressure: "elevated", admission: { councilId: "council", departmentId: "coding", planVersion: 1, itemId: "item", operatorId: "operator", credentialId: "credential" } }]);
    const deps = { ...baseDeps(), withGoalLease: vi.fn().mockRejectedValue(new LeaseUnavailableError()) }; const requeue = vi.fn(); const service = createWorkerService({ ...deps, capacity: { reserve: vi.fn(), release: vi.fn(), requeue } });
    await service.drainCapacityQueues?.();
    expect(requeue).toHaveBeenCalledWith("reservation-1");
  });

  it("releases an admitted reservation when provider admission fails", async () => {
    const deps = baseDeps(); const release = vi.fn().mockResolvedValue(undefined); const reserve = vi.fn().mockResolvedValue({ kind: "reserved", reservationId: "reservation-1" }); vi.mocked(spawnWorker).mockRejectedValueOnce(new Error("provider failed"));
    const service = createWorkerService({ ...deps, capacity: { reserve, release } });
    await expect(service.spawn("council", "coding", { projectId, planVersion: 1, itemId: "item" }, "00000000-0000-4000-8000-000000000004", { operatorId: "operator" })).rejects.toThrow("provider failed");
    expect(release).toHaveBeenCalledWith("reservation-1");
  });
});
