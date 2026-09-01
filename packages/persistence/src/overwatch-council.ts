import { randomUUID } from "node:crypto";
import {
  assertValidOverwatchJudgmentSubstance,
  evaluateOverwatchTriggers,
  synthesizeOverwatchJudgments,
  type ExecutionKernelPort,
  type OverwatchJudgmentSubstance,
  type OverwatchSynthesis,
  type OverwatchTriggerReason,
  type OverwatchVerdict,
} from "@maestro/domain";
import type { Pool } from "pg";

export class OverwatchCouncilError extends Error {}

export interface OverwatchCouncilRoundRequest {
  readonly goalId: string;
  readonly question: string;
  readonly criteria: readonly { readonly criterionId: string; readonly description: string }[];
  readonly evidenceIds: readonly string[];
  readonly reviewerCount: number;
}

export interface OverwatchCouncilResult {
  readonly roundId: string;
  readonly judgments: readonly OverwatchJudgmentSubstance[];
  readonly synthesis: OverwatchSynthesis;
}

/** Advisory: reports which plan/phase3.md trigger conditions are currently true for this Goal, from real durable state. Does not itself gate round creation -- Sane/a Head decides whether to act on it. */
export async function evaluateOverwatchCouncilTrigger(pool: Pool, goalId: string): Promise<readonly OverwatchTriggerReason[]> {
  const council = await pool.query<{ decision_packet: { departmentOwnership?: readonly unknown[] } | null }>(
    "SELECT decision_packet FROM head_councils WHERE goal_id = $1 AND state = 'resolved' ORDER BY created_at DESC LIMIT 1",
    [goalId],
  );
  const departmentOwnershipCount = council.rows[0]?.decision_packet?.departmentOwnership?.length ?? 0;
  const challenges = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM sentinel_challenges WHERE goal_id = $1 AND status <> 'resolved'", [goalId]);
  const reviews = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM semantic_reviews WHERE goal_id = $1 AND verdict IN ('unsupported', 'ambiguous')", [goalId]);
  return evaluateOverwatchTriggers({
    departmentOwnershipCount,
    openChallengeCount: Number(challenges.rows[0]!.count),
    ambiguousOrUnsupportedReviewCount: Number(reviews.rows[0]!.count),
  });
}

interface RawJudgmentOutput {
  readonly verdict: OverwatchVerdict;
  readonly confidence: "low" | "medium" | "high";
  readonly reasoning: string;
  readonly conditions: readonly string[];
  readonly dissentNote: string | null;
  readonly citedEvidenceIds: readonly string[];
}

function parseJudgmentOutput(rawText: string): RawJudgmentOutput {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  if (parsed.verdict !== "proceed" && parsed.verdict !== "do_not_proceed" && parsed.verdict !== "escalate") throw new OverwatchCouncilError("Invalid Overwatch judgment verdict");
  if (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high") throw new OverwatchCouncilError("Invalid Overwatch judgment confidence");
  if (typeof parsed.reasoning !== "string" || parsed.reasoning.trim() === "") throw new OverwatchCouncilError("Overwatch judgment reasoning is required");
  const conditions = Array.isArray(parsed.conditions) ? parsed.conditions.filter((item): item is string => typeof item === "string") : [];
  const citedEvidenceIds = Array.isArray(parsed.citedEvidenceIds) ? parsed.citedEvidenceIds.filter((item): item is string => typeof item === "string") : [];
  const dissentNote = typeof parsed.dissentNote === "string" && parsed.dissentNote.trim() !== "" ? parsed.dissentNote : null;
  return { verdict: parsed.verdict, confidence: parsed.confidence, reasoning: parsed.reasoning, conditions, dissentNote, citedEvidenceIds };
}

/**
 * Freezes the question/evidence/criteria, spawns `reviewerCount` fully
 * isolated reviewers (each a fresh parentless execution, so none can see
 * any peer's answer), records each one's ACTUAL model/provider identity,
 * and writes every judgment together in one sealed transaction only after
 * all reviewers have answered -- "Collect judgments before revealing peer
 * answers" is enforced by construction: no judgment row exists in the
 * database until every reviewer's answer has already been produced.
 */
export async function runOverwatchCouncilReview(pool: Pool, kernel: ExecutionKernelPort, request: OverwatchCouncilRoundRequest): Promise<OverwatchCouncilResult> {
  if (request.reviewerCount < 1) throw new OverwatchCouncilError("Overwatch Council review requires at least one reviewer");
  const goal = await pool.query("SELECT 1 FROM goals WHERE goal_id = $1", [request.goalId]);
  if (goal.rowCount !== 1) throw new OverwatchCouncilError("Goal not found for Overwatch Council review");
  const project = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [request.goalId]);
  const durable = await pool.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [request.goalId, project.rows[0]!.project_id]);
  const durableIds = new Set(durable.rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));
  for (const evidenceId of request.evidenceIds) if (!durableIds.has(evidenceId.trim())) throw new OverwatchCouncilError(`Overwatch Council evidence reference is not durable: ${evidenceId}`);

  const triggerReasons = await evaluateOverwatchCouncilTrigger(pool, request.goalId);
  const prompt = [
    "You are one of several fully independent Overwatch Council reviewers. You cannot see any other reviewer's answer.",
    `Question: ${request.question}`,
    `Criteria: ${request.criteria.map((criterion) => `[${criterion.criterionId}] ${criterion.description}`).join("; ")}`,
    `Evidence ids you may cite: ${request.evidenceIds.join(", ") || "(none)"}`,
    'Reply with exactly one JSON object: {"verdict":"proceed"|"do_not_proceed"|"escalate","confidence":"low"|"medium"|"high","reasoning":string,"conditions":string[],"dissentNote":string|null,"citedEvidenceIds":string[]}',
  ].join("\n");

  // Spawn every reviewer as its own fresh, parentless execution -- an
  // isolated lane, not a shared conversation -- before collecting any answer.
  const spawnedReviewers: { execution: unknown; invocation: unknown }[] = [];
  for (let index = 0; index < request.reviewerCount; index += 1) {
    spawnedReviewers.push(await kernel.spawn({ name: `overwatch-review:${randomUUID()}:${index}`, prompt }));
  }
  const judgments: (OverwatchJudgmentSubstance & { executionRef: string; invocationRef: string })[] = [];
  for (const spawned of spawnedReviewers) {
    const model = await kernel.getModelIdentity(spawned.execution as never);
    const observations = await kernel.observe(spawned.execution as never);
    const observation = observations.find((candidate) => candidate.invocation === spawned.invocation);
    const rawText = observation?.answer.state === "available" ? observation.answer.text : "";
    let output: RawJudgmentOutput;
    try {
      output = parseJudgmentOutput(rawText);
    } catch {
      output = { verdict: "escalate", confidence: "low", reasoning: "unparseable reviewer output", conditions: [], dissentNote: null, citedEvidenceIds: [] };
    }
    const substance: OverwatchJudgmentSubstance = {
      modelProvider: model.provider, modelId: model.id, verdict: output.verdict, confidence: output.confidence,
      reasoning: output.reasoning, conditions: output.conditions, dissentNote: output.dissentNote,
      citedEvidenceIds: output.citedEvidenceIds,
    };
    assertValidOverwatchJudgmentSubstance(substance);
    judgments.push({ ...substance, executionRef: String(spawned.execution), invocationRef: String(spawned.invocation) });
  }

  const synthesis = synthesizeOverwatchJudgments(judgments);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roundId = randomUUID();
    await client.query(
      `INSERT INTO overwatch_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
      [roundId, request.goalId, request.question, JSON.stringify(request.criteria), JSON.stringify(request.evidenceIds), JSON.stringify(triggerReasons), request.reviewerCount],
    );
    // Sealed: every judgment is written together, in the same transaction, only now that all reviewers have already answered.
    for (const [index, judgment] of judgments.entries()) {
      await client.query(
        `INSERT INTO overwatch_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13)`,
        [randomUUID(), roundId, index, judgment.modelProvider, judgment.modelId, judgment.verdict, judgment.confidence, judgment.reasoning, JSON.stringify(judgment.conditions), judgment.dissentNote, JSON.stringify(judgment.citedEvidenceIds), judgment.executionRef, judgment.invocationRef],
      );
    }
    await client.query(
      `INSERT INTO overwatch_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [roundId, synthesis.finalVerdict, synthesis.sameModelOnly, synthesis.escalated, JSON.stringify(synthesis.dissentNotes)],
    );
    await client.query("COMMIT");
    return { roundId, judgments, synthesis };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
