import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionKernelPort } from "@maestro/domain";
import { evaluateOverwatchCouncilTrigger, OverwatchCouncilError, runOverwatchCouncilReview } from "./overwatch-council.js";
import { acquireGoalLease } from "./commands.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { raiseSentinelChallenge } from "./sentinel-challenge.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0006_evidence.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0028_sentinel_findings.sql", "0029_sentinel_challenges.sql", "0030_semantic_reviews.sql", "0031_overwatch_council.sql", "0037_sentinel_challenge_idempotency.sql"];

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
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
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

  it("rejects direct tampering with immutable Overwatch Council records", async () => {
    const { goalId, evidenceId } = await setupGoalWithEvidence();
    const kernel = fakeKernelWithVerdicts([{ provider: "prime", id: "kimi", text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] }) }]);
    const result = await runOverwatchCouncilReview(pool, kernel, { goalId, question: "q", criteria, evidenceIds: [evidenceId], reviewerCount: 1 });
    await expect(pool.query("UPDATE overwatch_council_syntheses SET final_verdict = 'proceed' WHERE round_id = $1", [result.roundId])).rejects.toThrow();
    await expect(pool.query("UPDATE overwatch_council_judgments SET verdict = 'escalate' WHERE round_id = $1", [result.roundId])).rejects.toThrow();
  });
});
