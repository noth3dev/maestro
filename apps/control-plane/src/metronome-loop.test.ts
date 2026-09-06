import { describe, expect, it, vi } from "vitest";
import { createMetronomeLoop, type MetronomeLoopScheduler } from "./metronome-loop.js";

function fakeScheduler(): MetronomeLoopScheduler & { fire: () => void; intervalMs?: number; cleared: boolean } {
  let callback: (() => void) | undefined;
  const state = {
    cleared: false,
    intervalMs: undefined as number | undefined,
    setInterval(cb: () => void, ms: number) {
      callback = cb;
      state.intervalMs = ms;
      return "handle";
    },
    clearInterval() {
      state.cleared = true;
    },
    fire() {
      callback?.();
    },
  };
  return state;
}

function fakePool(rows: { goal_id: string; state: string }[]) {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) } as unknown as import("pg").Pool;
}

// A real `GoalLeaseProof`/`withGoalLease` and the real `scanGoalForMetronomeFindings` both expect
// real PostgreSQL rows; unit-testing the loop's own scheduling/error-isolation logic means faking
// both seams, not letting the loop reach the real durable scan.
const passthroughLease = (async (_goalId: string, operation: (proof: unknown) => Promise<unknown>) => operation({})) as never;

describe("createMetronomeLoop", () => {
  it("scans every non-terminal Goal once per tick and reports each outcome", async () => {
    const pool = fakePool([
      { goal_id: "goal-1", state: "active" },
      { goal_id: "goal-2", state: "paused" },
    ]);
    const scanGoal = vi.fn(async () => []);
    const ticks: { goalId: string; outcome: string }[] = [];
    const loop = createMetronomeLoop({
      pool, withGoalLease: passthroughLease, scanGoal: scanGoal as never, intervalMs: 60_000,
      onTick: (result) => ticks.push({ goalId: result.goalId, outcome: result.outcome }),
    });

    await loop.runOnce();

    expect(scanGoal).toHaveBeenCalledTimes(2);
    expect(ticks).toEqual([
      { goalId: "goal-1", outcome: "scanned" },
      { goalId: "goal-2", outcome: "scanned" },
    ]);
  });

  it("reports one Goal's scan error without stopping the rest of the pass", async () => {
    const pool = fakePool([
      { goal_id: "goal-1", state: "active" },
      { goal_id: "goal-2", state: "active" },
    ]);
    const scanGoal = vi.fn(async (_pool: unknown, goalId: string) => {
      if (goalId === "goal-1") throw new Error("lease contended");
      return [];
    });
    const ticks: { goalId: string; outcome: string }[] = [];
    const loop = createMetronomeLoop({
      pool, withGoalLease: passthroughLease, scanGoal: scanGoal as never, intervalMs: 60_000,
      onTick: (result) => ticks.push({ goalId: result.goalId, outcome: result.outcome }),
    });

    await loop.runOnce();

    expect(ticks).toEqual([
      { goalId: "goal-1", outcome: "error" },
      { goalId: "goal-2", outcome: "scanned" },
    ]);
  });

  it("schedules runOnce on the configured interval and clears it on stop", () => {
    const scheduler = fakeScheduler();
    const pool = fakePool([]);
    const loop = createMetronomeLoop({ pool, withGoalLease: passthroughLease, intervalMs: 45_000, scheduler });

    loop.start();
    expect(scheduler.intervalMs).toBe(45_000);
    loop.start();
    expect(scheduler.cleared).toBe(false);

    loop.stop();
    expect(scheduler.cleared).toBe(true);
  });

  it("does not run a second overlapping pass while one is still in flight", async () => {
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const pool = fakePool([{ goal_id: "goal-1", state: "active" }]);
    const scanGoal = vi.fn(async () => { await gate; return []; });
    const loop = createMetronomeLoop({ pool, withGoalLease: passthroughLease, scanGoal: scanGoal as never, intervalMs: 60_000 });

    const firstPass = loop.runOnce();
    const secondPass = loop.runOnce();
    releaseFirst?.();
    await Promise.all([firstPass, secondPass]);

    expect(scanGoal).toHaveBeenCalledTimes(1);
  });
});
