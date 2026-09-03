import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionKernelPort,
  InvocationAnswer,
  InvocationObservation,
  InvocationStatus,
  SpawnRequest,
  SpawnedInvocation,
} from "@maestro/domain";
import type { Pool } from "pg";
import { requestSemanticReview } from "./semantic-review.js";

const execution = "semantic-execution" as never;
const invocation = "semantic-invocation" as never;

function observation(status: InvocationStatus, answer: InvocationAnswer): InvocationObservation {
  return {
    invocation,
    name: "semantic-review",
    status,
    toolEvents: { state: "empty", events: [] },
    usage: { state: "unknown" },
    answer,
  };
}

function fakePool(): Pool {
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.startsWith("SELECT project_id FROM goals")) {
      return { rowCount: 1, rows: [{ project_id: "project-1" }] };
    }
    if (sql.startsWith("SELECT evidence_id, sha256 FROM evidence_records")) {
      return { rowCount: 1, rows: [{ evidence_id: "evidence-1", sha256: "sha-1" }] };
    }
    if (sql.startsWith("INSERT INTO semantic_reviews")) {
      return {
        rowCount: 1,
        rows: [{
          review_id: "review-1",
          goal_id: values?.[1],
          claim_text: values?.[2],
          verdict: values?.[6],
          cited_evidence_ids: JSON.parse(String(values?.[7])),
          reasoning: values?.[8],
        }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as Pool;
}

function fakeKernel(sequence: readonly InvocationObservation[]): ExecutionKernelPort & {
  spawn: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  calls: string[];
} {
  let observationIndex = 0;
  const calls: string[] = [];
  const spawned: SpawnedInvocation = { execution, invocation };
  return {
    spawn: vi.fn(async (request: SpawnRequest) => {
      calls.push("spawn");
      return spawned;
    }),
    prompt: vi.fn(async () => {
      calls.push("prompt");
    }),
    observe: vi.fn(async () => {
      calls.push("observe");
      const next = sequence[Math.min(observationIndex++, sequence.length - 1)];
      if (!next) throw new Error("No fake observation configured");
      return [next];
    }),
    async sendMessage() {},
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "unknown" }; },
    async getInvocationStatus() { return "unknown"; },
    release: vi.fn(async () => { calls.push("release"); }),
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
    calls,
  };
}

describe("semantic review execution", () => {
  const criteria = [{ criterionId: "evidence", description: "must cite durable evidence" }];
  const supported = JSON.stringify({
    verdict: "supported",
    citedEvidenceIds: ["evidence-1"],
    reasoning: "durable evidence matches",
  });

  it("creates a repository-rooted execution, prompts it after spawn, and waits for a terminal answer", async () => {
    const kernel = fakeKernel([
      observation("running", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
      observation("succeeded", { state: "available", text: supported }),
    ]);

    const review = await requestSemanticReview(fakePool(), kernel, "goal-1", "the claim", criteria);

    expect(kernel.spawn).toHaveBeenCalledWith({
      name: expect.stringMatching(/^semantic-review:/),
      cwd: process.cwd(),
    });
    expect(kernel.spawn.mock.calls[0]![0].prompt).toBeUndefined();
    expect(kernel.prompt).toHaveBeenCalledWith(execution, expect.stringContaining("the claim"));
    expect(kernel.calls.indexOf("spawn")).toBeLessThan(kernel.calls.indexOf("prompt"));
    expect(kernel.observe).toHaveBeenCalledTimes(2);
    expect(review.verdict).toBe("supported");
    // Once the review is durably recorded, the kernel's isolated one-shot
    // root execution may be released (Phase 1 re-patch item 2).
    expect(kernel.release).toHaveBeenCalledWith(invocation);
    expect(kernel.calls.at(-1)).toBe("release");
  });

  it("does not parse an answer observed before terminal completion", async () => {
    const kernel = fakeKernel([
      observation("running", { state: "available", text: supported }),
      observation("succeeded", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
    ]);

    const review = await requestSemanticReview(fakePool(), kernel, "goal-1", "the claim", criteria);

    expect(review.verdict).toBe("unsupported");
    expect(review.citedEvidenceIds).toEqual([]);
    // A durable row is always written on this path too (downgraded to
    // "unsupported"), so the kernel record is still released.
    expect(kernel.release).toHaveBeenCalledWith(invocation);
  });

  it("still returns the durably recorded review even when the kernel's release call fails", async () => {
    const kernel = fakeKernel([
      observation("running", { state: "unavailable", reason: "provider-does-not-expose-answer-text" }),
      observation("succeeded", { state: "available", text: supported }),
    ]);
    kernel.release = vi.fn(async () => { throw new Error("kernel eviction backend unavailable"); });

    const review = await requestSemanticReview(fakePool(), kernel, "goal-1", "the claim", criteria);

    expect(review.verdict).toBe("supported");
  });
});
