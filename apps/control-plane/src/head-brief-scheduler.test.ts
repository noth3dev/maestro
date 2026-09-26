import { describe, expect, it } from "vitest";
import { createHeadBriefScheduler } from "./head-brief-scheduler.js";
import type { HeadBriefRuntime } from "./head-brief-runtime.js";

describe("Head brief scheduler", () => {
  it("retries failed Heads until revealed and runs one stage per Goal at a time", async () => {
    const results = [
      { outcomes: [{ departmentId: "design", outcome: "failed" as const }], revealed: false },
      { outcomes: [{ departmentId: "design", outcome: "submitted" as const }], revealed: true },
    ];
    let calls = 0;
    const runtime: HeadBriefRuntime = { run: async () => results[calls++]! };
    const seen: boolean[] = [];
    const scheduler = createHeadBriefScheduler({ runtime, retryDelaysMs: [1, 1], onOutcome: (outcome) => seen.push(outcome.revealed) });
    scheduler.schedule({ goalId: "g", councilId: "c" });
    scheduler.schedule({ goalId: "g", councilId: "c" });
    await scheduler.idle();
    expect(calls).toBe(2);
    expect(seen).toEqual([false, true]);
  });

  it("stops without retrying when nothing failed, and gives up after the retry budget", async () => {
    let calls = 0;
    const waiting: HeadBriefRuntime = { run: async () => { calls += 1; return { outcomes: [{ departmentId: "a", outcome: "already_settled" }], revealed: false }; } };
    const quiet = createHeadBriefScheduler({ runtime: waiting, retryDelaysMs: [1] });
    quiet.schedule({ goalId: "g", councilId: "c" });
    await quiet.idle();
    expect(calls).toBe(1);

    calls = 0;
    const failing: HeadBriefRuntime = { run: async () => { calls += 1; return { outcomes: [{ departmentId: "a", outcome: "failed" }], revealed: false }; } };
    const errors: unknown[] = [];
    const bounded = createHeadBriefScheduler({ runtime: failing, retryDelaysMs: [1, 1], onError: (error) => errors.push(error) });
    bounded.schedule({ goalId: "g", councilId: "c" });
    await bounded.idle();
    expect(calls).toBe(3);
    expect(errors).toEqual([]);
  });
});
