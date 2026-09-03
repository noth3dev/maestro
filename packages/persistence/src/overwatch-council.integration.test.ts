import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionKernelPort } from "@maestro/domain";
import { evaluateOverwatchCouncilTrigger, OverwatchCouncilError, runOverwatchCouncilReview } from "./overwatch-council.js";
import { requestSemanticReview } from "./semantic-review.js";
import { acquireGoalLease } from "./commands.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { raiseSentinelChallenge } from "./sentinel-challenge.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const criteria = [{ criterionId: "safety", description: "does this preserve safety invariants" }];
const sentinelContext = (label: string) => ({ actorId: "  overwatch-sentinel  ", sessionRef: `sentinel-session:${label}`, commandId: randomUUID() });

function fakeKernelWithVerdicts(verdicts: readonly { provider: string; id: string; text: string }[]): ExecutionKernelPort {
  let counter = 0;
  const models = new Map<string, { provider: string; id: string; text: string }>();
  return {
    async spawn() {
      const index = counter; counter += 1;
      const execution = `exec-${index}`;
      models.set(execution, verdicts[index]!);
      return { execution: execution as never, invocation: `inv-${index}` as never };
    },
    async prompt() {}, async sendMessage() {},
    async observe(execution) {
      const spec = models.get(execution as unknown as string)!;
      const executionIndex = (execution as unknown as string).replace("exec-", "");
      return [{ invocation: `inv-${executionIndex}` as never, name: "reviewer", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: spec.text } }];
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity(execution) { const spec = models.get(execution as unknown as string)!; return { provider: spec.provider, id: spec.id }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Overwatch Council with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupGoalWithEvidence() {
    const goalId = randomUUID(), projectId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const evidenceId = randomUUID();
    await pool.query(
      "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
      [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "sentinel-test", leaseDurationMs: 60_000 });
    return { goalId, projectId, evidenceId, proof };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS overwatch_council_syntheses, overwatch_council_judgments, overwatch_council_rounds, semantic_reviews, sentinel_challenge_findings, sentinel_challenges, sentinel_findings, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, departments, organization_groups, permanent_roles, permanent_head_roles, role_persona_axes, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE overwatch_council_syntheses, overwatch_council_judgments, overwatch_council_rounds, semantic_reviews, sentinel_challenge_findings, sentinel_challenges, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals RESTART IDENTITY CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("does not report a trigger for a routine Goal with no signals", async () => {
    const { goalId } = await setupGoalWithEvidence();
    const triggers = await evaluateOverwatchCouncilTrigger(pool, goalId);
    expect(triggers).toHaveLength(0);
  });

  it("reports the unresolved-challenge trigger once a Sentinel challenge is open", async () => {
    const { goalId, proof } = await setupGoalWithEvidence();
    await raiseSentinelChallenge(pool, goalId, [], { reason: "concern", evidenceReferences: [] }, proof, sentinelContext("trigger"));
    const triggers = await evaluateOverwatchCouncilTrigger(pool, goalId);
    expect(triggers).toContain("unresolved_sentinel_challenge");
  });

  it("runs a genuinely multi-model review, records real model identities, and reaches proceed with no dissent", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelWithVerdicts([
      { provider: "prime", id: "kimi", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) },
      { provider: "openai", id: "gpt", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) },
    ]);
    const result = await runOverwatchCouncilReview(pool, kernel, { goalId, question: "should we proceed?", criteria, evidenceIds: [evidenceId], reviewerCount: 2 });
    expect(result.synthesis.finalVerdict).toBe("proceed");
    expect(result.synthesis.sameModelOnly).toBe(false);
    expect(result.synthesis.escalated).toBe(false);
    const models = await pool.query("SELECT model_provider, model_id FROM overwatch_council_judgments WHERE round_id = $1 ORDER BY reviewer_index", [result.roundId]);
    expect(models.rows).toEqual([{ model_provider: "prime", model_id: "kimi" }, { model_provider: "openai", model_id: "gpt" }]);
  });

  it("escalates and preserves the dissent note when reviewers materially disagree", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelWithVerdicts([
      { provider: "prime", id: "kimi", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) },
      { provider: "openai", id: "gpt", text: JSON.stringify({ verdict: "do_not_proceed", confidence: "high", reasoning: "unsafe", conditions: [], dissentNote: "I believe this is unsafe", citedEvidenceIds: [evidenceId] }) },
    ]);
    const result = await runOverwatchCouncilReview(pool, kernel, { goalId, question: "should we proceed?", criteria, evidenceIds: [evidenceId], reviewerCount: 2 });
    expect(result.synthesis.escalated).toBe(true);
    expect(result.synthesis.finalVerdict).toBe("escalate");
    expect(result.synthesis.dissentNotes).toEqual(["I believe this is unsafe"]);
    const synthesisRow = await pool.query("SELECT escalated, dissent_notes FROM overwatch_council_syntheses WHERE round_id = $1", [result.roundId]);
    expect(synthesisRow.rows[0]!.escalated).toBe(true);
    expect(synthesisRow.rows[0]!.dissent_notes).toEqual(["I believe this is unsafe"]);
  });

  it("labels a same-model-only round honestly and rejects an evidence reference that is not durable", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelWithVerdicts([
      { provider: "prime", id: "kimi", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) },
      { provider: "prime", id: "kimi", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) },
    ]);
    const result = await runOverwatchCouncilReview(pool, kernel, { goalId, question: "should we proceed?", criteria, evidenceIds: [evidenceId], reviewerCount: 2 });
    expect(result.synthesis.sameModelOnly).toBe(true);
    await expect(runOverwatchCouncilReview(pool, kernel, { goalId, question: "q", criteria, evidenceIds: ["fabricated"], reviewerCount: 1 })).rejects.toBeInstanceOf(OverwatchCouncilError);
  });

  it("composes unsupported semantic uncertainty into a sealed same-model Council round", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const councilAnswer = (verdict: string, dissentNote: string | null) => JSON.stringify({
      verdict, confidence: "high", reasoning: verdict === "proceed" ? "claim lacks support" : "uncertainty requires adjudication",
      conditions: [], dissentNote, citedEvidenceIds: [evidenceId],
    });
    const answers = [
      JSON.stringify({ verdict: "supported", citedEvidenceIds: [], reasoning: "the claim sounds plausible" }),
      councilAnswer("proceed", null),
      councilAnswer("do_not_proceed", "Unsupported claim must not be treated as established."),
      councilAnswer("proceed", null),
    ];
    const sealedCounts: number[] = [];
    let next = 0;
    const executions = new Map<string, string>();
    const kernel: ExecutionKernelPort = {
      async spawn() { const execution = `council-round-exec-${next}`; executions.set(execution, `council-round-inv-${next}`); next += 1; return { execution: execution as never, invocation: executions.get(execution) as never }; },
      async prompt(execution, prompt) {
        if (prompt.includes("Overwatch Council reviewers")) {
          const count = await pool.query("SELECT count(*)::int AS count FROM overwatch_council_judgments");
          sealedCounts.push(Number(count.rows[0]!.count));
        }
      },
      async sendMessage() {},
      async observe(execution) {
        const invocation = executions.get(execution as unknown as string)!;
        const index = Number((execution as unknown as string).split("-").at(-1));
        return [{ invocation: invocation as never, name: "reviewer", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: answers[index]! } }];
      },
      async cancel() { return { cancelled: true }; },
      async getModelIdentity() { return { provider: "prime", id: "kimi" }; },
      async getToolEvents() { return { state: "empty", events: [] }; },
      async getUsage() { return { state: "available", totalTokens: 1 }; },
      async getInvocationStatus() { return "succeeded"; },
      async resume() { throw new Error("not supported"); },
      async reconnect() { throw new Error("not supported"); },
    };

    const semantic = await requestSemanticReview(pool, kernel, goalId, "the release is safe", criteria);
    expect(semantic.verdict).toBe("unsupported");
    expect(semantic.citedEvidenceIds).toEqual([]);
    expect(await evaluateOverwatchCouncilTrigger(pool, goalId)).toContain("high_uncertainty_semantic_review");

    const result = await runOverwatchCouncilReview(pool, kernel, {
      goalId, question: "Should this unsupported claim be allowed to influence release?", criteria, evidenceIds: [evidenceId], reviewerCount: 3,
    });
    expect(result.judgments).toHaveLength(3);
    expect(result.judgments.every((judgment) => judgment.modelProvider === "prime" && judgment.modelId === "kimi")).toBe(true);
    expect(result.synthesis.sameModelOnly).toBe(true);
    expect(result.synthesis.escalated).toBe(true);
    expect(result.synthesis.finalVerdict).toBe("escalate");
    expect(result.synthesis.dissentNotes).toEqual(["Unsupported claim must not be treated as established."]);
    // This is the honest fallback label required when only one model family is available.
    expect(result.synthesis.sameModelOnly ? "same-model-independent-review" : "multi-model-independent-review").toBe("same-model-independent-review");
    // No judgment is persisted until every isolated reviewer has answered.
    expect(sealedCounts).toEqual([0, 0, 0]);
    const stored = await pool.query("SELECT count(*)::int AS count FROM overwatch_council_judgments");
    expect(Number(stored.rows[0]!.count)).toBe(3);
  });

  it("rejects direct tampering with immutable Overwatch Council records", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelWithVerdicts([{ provider: "prime", id: "kimi", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) }]);
    const result = await runOverwatchCouncilReview(pool, kernel, { goalId, question: "q", criteria, evidenceIds: [evidenceId], reviewerCount: 1 });
    await expect(pool.query("UPDATE overwatch_council_syntheses SET final_verdict = 'proceed' WHERE round_id = $1", [result.roundId])).rejects.toThrow();
    await expect(pool.query("UPDATE overwatch_council_judgments SET verdict = 'escalate' WHERE round_id = $1", [result.roundId])).rejects.toThrow();
  });
});
