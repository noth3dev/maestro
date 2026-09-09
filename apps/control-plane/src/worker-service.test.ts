import { describe, expect, it, vi } from "vitest";
import type { ExecutionKernelPort } from "@maestro/domain";
import type { Pool } from "pg";
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
