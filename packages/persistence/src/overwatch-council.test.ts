import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionKernelPort,
  InvocationAnswer,
  InvocationObservation,
  InvocationStatus,
  SpawnRequest,
  SpawnedInvocation,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { runOverwatchCouncilReview } from "./overwatch-council.js";

const criteria = [{ criterionId: "safety", description: "preserve safety invariants" }];
const goalId = "goal-1";
const evidenceId = "evidence-1";

function fakePool(): Pool {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT 1 FROM goals")) return { rowCount: 1, rows: [{}] };
    if (sql.startsWith("SELECT project_id FROM goals")) return { rowCount: 1, rows: [{ project_id: "project-1" }] };
    if (sql.startsWith("SELECT evidence_id, sha256 FROM evidence_records")) return { rowCount: 1, rows: [{ evidence_id: evidenceId, sha256: "sha-1" }] };
    if (sql.startsWith("SELECT decision_packet FROM head_councils")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM sentinel_challenges")) return { rowCount: 1, rows: [{ count: "0" }] };
    if (sql.includes("FROM semantic_reviews")) return { rowCount: 1, rows: [{ count: "0" }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  const clientQuery = vi.fn(async () => ({ rowCount: 1, rows: [] }));
  const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  return { query, connect } as unknown as Pool;
}

function observation(index: number, status: InvocationStatus, answer: InvocationAnswer): InvocationObservation {
  return {
    invocation: `overwatch-invocation-${index}` as never,
    name: "overwatch-review",
    status,
    toolEvents: { state: "empty", events: [] },
    usage: { state: "unknown" },
    answer,
  };
}

function fakeKernel(sequences: readonly (readonly InvocationObservation[])[]): ExecutionKernelPort & {
  spawn: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  calls: string[];
} {
  const calls: string[] = [];
  const spawned: SpawnedInvocation[] = sequences.map((_, index) => ({
    execution: `overwatch-execution-${index}` as never,
    invocation: `overwatch-invocation-${index}` as never,
  }));
  const observationIndexes = sequences.map(() => 0);
  return {
    spawn: vi.fn(async (request: SpawnRequest) => {
      const index = calls.filter((call) => call.startsWith("spawn")).length;
      calls.push(`spawn-${index}`);
      return spawned[index]!;
    }),
    prompt: vi.fn(async (execution: SpawnedInvocation["execution"]) => {
      calls.push(`prompt-${String(execution)}`);
    }),
    observe: vi.fn(async (execution: SpawnedInvocation["execution"]) => {
      const index = spawned.findIndex((item) => item.execution === execution);
      calls.push(`observe-${index}`);
      const sequence = sequences[index]!;
      const current = sequence[Math.min(observationIndexes[index]!, sequence.length - 1)];
      observationIndexes[index]! += 1;
      if (!current) throw new Error("No fake observation configured");
      return [current];
    }),
    async sendMessage() {},
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "model" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "unknown" }; },
    async getInvocationStatus() { return "unknown"; },
    release: vi.fn(async (invocation: unknown) => { calls.push(`release-${String(invocation)}`); }),
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
    calls,
  };
}

describe("Overwatch Council execution", () => {
  const proceed = JSON.stringify({
    verdict: "proceed",
    confidence: "high",
    reasoning: "durable evidence supports proceeding",
    conditions: [],
    dissentNote: null,
    citedEvidenceIds: [evidenceId],
  });

  it("spawns all repository-rooted reviewers before prompting and waits for terminal judgments", async () => {
    const kernel = fakeKernel([
      [
        observation(0, "queued", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
        observation(0, "succeeded", { state: "available", text: proceed }),
      ],
      [
        observation(1, "running", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
        observation(1, "succeeded", { state: "available", text: proceed }),
      ],
    ]);

    const result = await runOverwatchCouncilReview(fakePool(), kernel, {
      goalId,
      question: "should we proceed?",
      criteria,
      evidenceIds: [evidenceId],
      reviewerCount: 2,
    });

    expect(kernel.spawn).toHaveBeenCalledTimes(2);
    for (const [request] of kernel.spawn.mock.calls) {
      expect(request).toMatchObject({ cwd: process.cwd() });
      expect(request.prompt).toBeUndefined();
    }
    expect(kernel.prompt).toHaveBeenCalledTimes(2);
    expect(kernel.calls.slice(0, 2)).toEqual(["spawn-0", "spawn-1"]);
    expect(kernel.observe).toHaveBeenCalledTimes(4);
    expect(result.synthesis.finalVerdict).toBe("proceed");
    // The sealed round committed durably (both judgments written together in
    // one transaction), so every isolated reviewer's kernel record may now
    // be released (Phase 1 re-patch item 2).
    expect(kernel.release).toHaveBeenCalledTimes(2);
    expect(kernel.release).toHaveBeenCalledWith("overwatch-invocation-0");
    expect(kernel.release).toHaveBeenCalledWith("overwatch-invocation-1");
  });

  it("escalates when the only available answer was observed before terminal completion", async () => {
    const kernel = fakeKernel([[
      observation(0, "running", { state: "available", text: proceed }),
      observation(0, "succeeded", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
    ]]);

    const result = await runOverwatchCouncilReview(fakePool(), kernel, {
      goalId,
      question: "should we proceed?",
      criteria,
      evidenceIds: [evidenceId],
      reviewerCount: 1,
    });

    expect(kernel.observe).toHaveBeenCalledTimes(2);
    expect(result.judgments[0]).toMatchObject({ verdict: "escalate", confidence: "low" });
    expect(result.synthesis.finalVerdict).toBe("escalate");
    expect(result.synthesis.escalated).toBe(true);
    expect(kernel.release).toHaveBeenCalledWith("overwatch-invocation-0");
  });

  it("still returns the durably committed round even when the kernel's release call fails for a reviewer", async () => {
    const kernel = fakeKernel([
      [
        observation(0, "queued", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
        observation(0, "succeeded", { state: "available", text: proceed }),
      ],
    ]);
    kernel.release = vi.fn(async () => { throw new Error("kernel eviction backend unavailable"); });

    const result = await runOverwatchCouncilReview(fakePool(), kernel, {
      goalId,
      question: "should we proceed?",
      criteria,
      evidenceIds: [evidenceId],
      reviewerCount: 1,
    });

    expect(result.synthesis.finalVerdict).toBe("proceed");
  });
});
