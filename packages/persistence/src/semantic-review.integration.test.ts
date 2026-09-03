import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionKernelPort } from "@maestro/domain";
import { listSemanticReviews, requestSemanticReview } from "./semantic-review.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function fakeKernelReturning(answerText: string): ExecutionKernelPort {
  return {
    async spawn(request) { return { execution: "exec-1" as never, invocation: "inv-1" as never }; },
    async prompt() {}, async sendMessage() {},
    async observe() {
      return [{ invocation: "inv-1" as never, name: "semantic-review", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: answerText } }];
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Semantic review with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupGoalWithEvidence() {
    const goalId = randomUUID(), projectId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const evidenceId = randomUUID();
    await pool.query(
      "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
      [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
    );
    return { goalId, evidenceId };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS semantic_reviews, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE semantic_reviews, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals RESTART IDENTITY CASCADE"); });
  afterAll(async () => { await pool.end(); });

  const criteria = [{ criterionId: "evidence-cited", description: "must cite verifiable evidence" }];

  it("records a supported verdict when the model cites real durable evidence", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelReturning(JSON.stringify({ verdict: "supported", citedEvidenceIds: [evidenceId], reasoning: "matches durable evidence" }));
    const review = await requestSemanticReview(pool, kernel, goalId, "the migration is backward compatible", criteria);
    expect(review.verdict).toBe("supported");
    expect(review.citedEvidenceIds).toContain(evidenceId);
    const listed = await listSemanticReviews(pool, goalId);
    expect(listed).toHaveLength(1);
  });

  it("downgrades a claimed-supported verdict to unsupported when the cited evidence is fabricated", async () => {
    const { goalId } = await setupGoalWithEvidence();
    const kernel = fakeKernelReturning(JSON.stringify({ verdict: "supported", citedEvidenceIds: ["fabricated-id"], reasoning: "trust me" }));
    const review = await requestSemanticReview(pool, kernel, goalId, "an unsupported claim", criteria);
    expect(review.verdict).toBe("unsupported");
  });

  it("records unsupported with a diagnostic reasoning when the model output is not parseable JSON", async () => {
    const { goalId } = await setupGoalWithEvidence();
    const kernel = fakeKernelReturning("not json at all");
    const review = await requestSemanticReview(pool, kernel, goalId, "a claim", criteria);
    expect(review.verdict).toBe("unsupported");
    expect(review.reasoning).toContain("unparseable");
  });

  it("rejects direct tampering with an immutable semantic review record", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelReturning(JSON.stringify({ verdict: "supported", citedEvidenceIds: [evidenceId], reasoning: "ok" }));
    const review = await requestSemanticReview(pool, kernel, goalId, "claim", criteria);
    await expect(pool.query("UPDATE semantic_reviews SET verdict = 'ambiguous' WHERE review_id = $1", [review.reviewId])).rejects.toThrow();
  });
});
