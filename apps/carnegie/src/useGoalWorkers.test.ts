import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGoalWorkers } from "./useGoalWorkers.js";

const harness = vi.hoisted(() => ({
  config: { projectId: "11111111-1111-4111-8111-111111111111" },
  goalId: "22222222-2222-4222-8222-222222222222",
  stateIndex: 0,
  stateValues: [] as unknown[],
  initialized: [] as boolean[],
  effects: [] as Array<() => void | (() => void)>,
  ref: { current: undefined as string | undefined },
  api: { listWorkersForGoal: vi.fn() },
}));

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = harness.stateIndex++;
    if (!harness.initialized[index]) {
      harness.stateValues[index] = initial;
      harness.initialized[index] = true;
    }
    return [harness.stateValues[index], (next: unknown) => {
      harness.stateValues[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(harness.stateValues[index]) : next;
    }];
  },
  useRef: () => harness.ref,
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
}));
vi.mock("./connection.js", () => ({ useConnection: () => ({ config: harness.config }) }));
vi.mock("./goals.js", () => ({ useGoals: () => ({ selectedGoalId: harness.goalId }) }));

vi.stubGlobal("window", { maestro: { api: harness.api } });

describe("useGoalWorkers stale refresh", () => {
  beforeEach(() => {
    harness.goalId = "22222222-2222-4222-8222-222222222222";
    harness.stateIndex = 0;
    harness.stateValues = [[{ workerId: "worker-1" }], false, undefined, undefined];
    harness.initialized = [true, true, true, true];
    harness.effects = [];
    harness.ref.current = "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
    harness.api.listWorkersForGoal.mockReset();
  });

  it("keeps the last same-scope roster visible when refresh fails", async () => {
    harness.api.listWorkersForGoal.mockRejectedValue(new Error("disconnected"));
    const result = useGoalWorkers("event-2");
    await harness.effects[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(result.workers).toEqual([{ workerId: "worker-1" }]);
    expect(harness.stateValues[0]).toEqual([{ workerId: "worker-1" }]);
    expect(harness.stateValues[2]).toBe("disconnected");
    expect(harness.api.listWorkersForGoal).toHaveBeenCalledWith(harness.goalId, { projectId: harness.config.projectId });
  });

  it("clears the roster only when project or Goal scope changes", async () => {
    harness.goalId = "33333333-3333-4333-8333-333333333333";
    harness.api.listWorkersForGoal.mockResolvedValue({ workers: [] });
    useGoalWorkers("event-3");
    await harness.effects[0]?.();
    expect(harness.ref.current).toBe("11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333");
    expect(harness.stateValues[0]).toEqual([]);
  });
});
