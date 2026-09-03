import { randomUUID } from "node:crypto";
import {
  assertValidOverwatchJudgmentSubstance,
  evaluateOverwatchTriggers,
  synthesizeOverwatchJudgments,
  type ExecutionKernelPort,
  type InvocationObservation,
  type InvocationStatus,
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

export interface OverwatchCouncilRound {
  readonly roundId: string; readonly goalId: string; readonly question: string;
  readonly criteria: readonly { readonly criterionId: string; readonly description: string }[];
  readonly evidenceIds: readonly string[]; readonly triggerReasons: readonly string[]; readonly reviewerCount: number;
  readonly judgments: readonly OverwatchJudgmentSubstance[]; readonly synthesis: OverwatchSynthesis;
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

const MAX_TERMINAL_OBSERVATIONS = 8;

function isTerminalStatus(status: InvocationStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** Observe until the adapter reports a terminal status, without trusting one
 * queued/running/unknown snapshot as a submitted judgment. */
async function observeTerminal(
  kernel: ExecutionKernelPort,
  execution: Parameters<ExecutionKernelPort["observe"]>[0],
  invocation: Parameters<ExecutionKernelPort["cancel"]>[0],
): Promise<InvocationObservation | undefined> {
  let latest: InvocationObservation | undefined;
  for (let attempt = 0; attempt < MAX_TERMINAL_OBSERVATIONS; attempt += 1) {
    const observations = await kernel.observe(execution);
    latest = observations.find((candidate) => candidate.invocation === invocation);
    if (latest && isTerminalStatus(latest.status)) return latest;
  }
  return latest;
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
    // A root spawn admits an isolated session; it does not submit this prompt.
    spawnedReviewers.push(await kernel.spawn({ name: `overwatch-review:${randomUUID()}:${index}`, cwd: process.cwd() }));
  }
  const judgments: (OverwatchJudgmentSubstance & { executionRef: string; invocationRef: string })[] = [];
  for (const spawned of spawnedReviewers) {
    const model = await kernel.getModelIdentity(spawned.execution as never);
    let observation: InvocationObservation | undefined;
    let promptError: unknown;
    try {
      await kernel.prompt(spawned.execution as never, prompt);
      observation = await observeTerminal(kernel, spawned.execution as never, spawned.invocation as never);
    } catch (error) {
      promptError = error;
    }
    const rawText = observation?.status === "succeeded" && observation.answer.state === "available"
      ? observation.answer.text
      : "";
    let output: RawJudgmentOutput;
    try {
      output = parseJudgmentOutput(rawText);
    } catch {
      output = {
        verdict: "escalate",
        confidence: "low",
        reasoning: promptError instanceof Error ? `reviewer prompt failed: ${promptError.message}` : "unparseable reviewer output",
        conditions: [],
        dissentNote: null,
        citedEvidenceIds: [],
      };
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
    // The sealed round is now durably committed (every judgment written
    // together in one transaction). Each isolated reviewer's kernel record
    // may be released; this happens after commit, never before or on a
    // rollback path, so a retried/failed round still has its terminal
    // observations available (Phase 1 re-patch item 2). Best-effort: a
    // release failure must never surface as a round failure (which would
    // also wrongly attempt a ROLLBACK after this COMMIT already succeeded),
    // since the durable round is already committed above.
    for (const spawned of spawnedReviewers) await kernel.release?.(spawned.invocation as never).catch(() => {});
    return { roundId, judgments, synthesis };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}


/** Reads complete, immutable Overwatch rounds for one Goal. */
export async function listOverwatchCouncilRounds(pool: Pool, goalId: string): Promise<readonly OverwatchCouncilRound[]> {
  const rounds = await pool.query<{ round_id: string; goal_id: string; question: string; criteria: { criterionId: string; description: string }[]; evidence_ids: string[]; trigger_reasons: string[]; reviewer_count: number; final_verdict: OverwatchVerdict; same_model_only: boolean; escalated: boolean; dissent_notes: string[] }>(
    `SELECT r.round_id, r.goal_id, r.question, r.criteria, r.evidence_ids, r.trigger_reasons, r.reviewer_count,
            s.final_verdict, s.same_model_only, s.escalated, s.dissent_notes
       FROM overwatch_council_rounds r JOIN overwatch_council_syntheses s ON s.round_id = r.round_id
      WHERE r.goal_id = $1 ORDER BY r.created_at, r.round_id`, [goalId],
  );
  const result: OverwatchCouncilRound[] = [];
  for (const row of rounds.rows) {
    const judgments = await pool.query<{ model_provider: string; model_id: string; verdict: OverwatchVerdict; confidence: "low"|"medium"|"high"; reasoning: string; conditions: string[]; dissent_note: string|null; cited_evidence_ids: string[] }>(
      `SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids
         FROM overwatch_council_judgments WHERE round_id = $1 ORDER BY reviewer_index`, [row.round_id],
    );
    result.push({ roundId: row.round_id, goalId: row.goal_id, question: row.question, criteria: row.criteria, evidenceIds: row.evidence_ids, triggerReasons: row.trigger_reasons, reviewerCount: row.reviewer_count, judgments: judgments.rows.map((judgment) => ({ modelProvider: judgment.model_provider, modelId: judgment.model_id, verdict: judgment.verdict, confidence: judgment.confidence, reasoning: judgment.reasoning, conditions: judgment.conditions, dissentNote: judgment.dissent_note, citedEvidenceIds: judgment.cited_evidence_ids })), synthesis: { finalVerdict: row.final_verdict, sameModelOnly: row.same_model_only, escalated: row.escalated, dissentNotes: row.dissent_notes } });
  }
  return result;
}
