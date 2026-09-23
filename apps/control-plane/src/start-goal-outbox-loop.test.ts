import { describe, expect, it, vi } from "vitest";
import {
  GoalOrchestrationBindingError,
  GoalOrchestrationEnvelopeError,
  type GoalOutboxMessage,
} from "@maestro/persistence";
import { createStartGoalOutboxLoop, type StartGoalOutboxLoopScheduler } from "./start-goal-outbox-loop.js";

function fakeScheduler(): StartGoalOutboxLoopScheduler & { fire: () => void; intervalMs?: number; cleared: boolean } {
  let callback: (() => void) | undefined;
  const state = {
    cleared: false,
    intervalMs: undefined as number | undefined,
    setInterval(cb: () => void, milliseconds: number) {
      callback = cb;
      state.intervalMs = milliseconds;
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

function message(outboxId: string): GoalOutboxMessage {
  return { outboxId, eventId: `event-${outboxId}`, topic: "goal-events", payload: {}, attempts: 1 };
}

const pool = {} as import("pg").Pool;

function loopDependencies(overrides: Record<string, unknown> = {}) {
  return {
    pool,
    ownerId: "start-goal-loop",
    intervalMs: 1_000,
    ...overrides,
  } as never;
}

describe("createStartGoalOutboxLoop", () => {
  it("validates and marks a claimed start_goal row delivered", async () => {
    const claimed = message("1");
    const claim = vi.fn(async () => [claimed]);
    const validate = vi.fn(async () => ({ type: "start_goal" }));
    const markDelivered = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const ticks: unknown[] = [];
    const loop = createStartGoalOutboxLoop(loopDependencies({ claim, validate, markDelivered, release, onTick: (result: unknown) => ticks.push(result) }));

    await loop.runOnce();

    expect(validate).toHaveBeenCalledWith(pool, claimed);
    expect(markDelivered).toHaveBeenCalledWith(pool, "1", "start-goal-loop");
    expect(release).not.toHaveBeenCalled();
    expect(ticks).toEqual([{ outboxId: "1", eventId: "event-1", outcome: "delivered" }]);
  });

  it("marks a malformed envelope delivered as a terminal poison message", async () => {
    const claimed = message("2");
    const claim = vi.fn(async () => [claimed]);
    const validate = vi.fn(async () => { throw new GoalOrchestrationEnvelopeError(); });
    const markDelivered = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const ticks: unknown[] = [];
    const loop = createStartGoalOutboxLoop(loopDependencies({ claim, validate, markDelivered, release, onTick: (result: unknown) => ticks.push(result) }));

    await loop.runOnce();

    expect(markDelivered).toHaveBeenCalledWith(pool, "2", "start-goal-loop");
    expect(release).not.toHaveBeenCalled();
    expect(ticks).toEqual([{ outboxId: "2", eventId: "event-2", outcome: "invalid_envelope" }]);
  });

  it("marks a durable binding mismatch delivered without retrying it", async () => {
    const claimed = message("3");
    const claim = vi.fn(async () => [claimed]);
    const validate = vi.fn(async () => { throw new GoalOrchestrationBindingError(); });
    const markDelivered = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const ticks: unknown[] = [];
    const loop = createStartGoalOutboxLoop(loopDependencies({ claim, validate, markDelivered, release, onTick: (result: unknown) => ticks.push(result) }));

    await loop.runOnce();

    expect(markDelivered).toHaveBeenCalledWith(pool, "3", "start-goal-loop");
    expect(release).not.toHaveBeenCalled();
    expect(ticks).toEqual([{ outboxId: "3", eventId: "event-3", outcome: "invalid_binding" }]);
  });

  it("releases a transient validation failure for bounded retry", async () => {
    const claimed = message("4");
    const claim = vi.fn(async () => [claimed]);
    const validate = vi.fn(async () => { throw new Error("database unavailable"); });
    const markDelivered = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const ticks: unknown[] = [];
    const loop = createStartGoalOutboxLoop(loopDependencies({ retryDelayMs: 777, claim, validate, markDelivered, release, onTick: (result: unknown) => ticks.push(result) }));

    await loop.runOnce();

    expect(markDelivered).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(pool, "4", "start-goal-loop", 777);
    expect(ticks).toEqual([{ outboxId: "4", eventId: "event-4", outcome: "retry", error: expect.any(Error) }]);
  });

  it("continues the batch after a poison message", async () => {
    const first = message("5");
    const second = message("6");
    const claim = vi.fn(async () => [first, second]);
    const validate = vi.fn(async (_pool: unknown, current: GoalOutboxMessage) => {
      if (current.outboxId === "5") throw new GoalOrchestrationEnvelopeError();
      return { type: "start_goal" };
    });
    const markDelivered = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const ticks: unknown[] = [];
    const loop = createStartGoalOutboxLoop(loopDependencies({ claim, validate, markDelivered, release, onTick: (result: unknown) => ticks.push(result) }));

    await loop.runOnce();

    expect(markDelivered).toHaveBeenCalledTimes(2);
    expect(ticks.map((tick) => (tick as { outcome: string }).outcome)).toEqual(["invalid_envelope", "delivered"]);
  });

  it("does not overlap passes and starts/stops its interval idempotently", async () => {
    const scheduler = fakeScheduler();
    let releasePass!: () => void;
    const pass = new Promise<void>((resolve) => { releasePass = resolve; });
    const claim = vi.fn(async () => { await pass; return []; });
    const loop = createStartGoalOutboxLoop(loopDependencies({ scheduler, claim }));

    loop.start();
    loop.start();
    expect(scheduler.intervalMs).toBe(1_000);
    scheduler.fire();
    const overlapping = loop.runOnce();
    releasePass();
    await overlapping;
    loop.stop();
    loop.stop();

    expect(claim).toHaveBeenCalledTimes(1);
    expect(scheduler.cleared).toBe(true);
  });
});
