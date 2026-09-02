import { randomUUID } from "node:crypto";
import {
  buildSemanticReviewPrompt,
  InvalidSemanticReviewOutputError,
  parseSemanticReviewOutput,
  resolveSemanticReviewVerdict,
  type ExecutionKernelPort,
  type InvocationObservation,
  type InvocationStatus,
  type SemanticReviewCriterion,
  type SemanticReviewVerdict,
} from "@maestro/domain";
import type { Pool } from "pg";

export class SemanticReviewError extends Error {}

export interface SemanticReview {
  readonly reviewId: string;
  readonly goalId: string;
  readonly claimText: string;
  readonly verdict: SemanticReviewVerdict;
  readonly citedEvidenceIds: readonly string[];
  readonly reasoning: string | null;
}

interface ReviewRow {
  review_id: string; goal_id: string; claim_text: string; verdict: SemanticReviewVerdict;
  cited_evidence_ids: string[]; reasoning: string | null;
}

function mapReview(row: ReviewRow): SemanticReview {
  return { reviewId: row.review_id, goalId: row.goal_id, claimText: row.claim_text, verdict: row.verdict, citedEvidenceIds: row.cited_evidence_ids, reasoning: row.reasoning };
}

const MAX_TERMINAL_OBSERVATIONS = 8;

function isTerminalStatus(status: InvocationStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** Observe until the adapter reports a terminal status, without treating one
 * queued/running/unknown snapshot as the review result. */
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

/**
 * Requests one isolated semantic review of a claim against fixed criteria.
 * "Isolated" means a fresh root execution with no parent -- it shares no
 * session, history, or peer answer with any other reviewer. The model's
 * claimed verdict is never trusted directly: unparseable output is recorded
 * as `unsupported` with the parse failure as its reasoning, and even a
 * successfully parsed verdict is downgraded to `unsupported` if it cites no
 * durable evidence, exactly matching plan/phase3.md's stated rule.
 */
export async function requestSemanticReview(pool: Pool, kernel: ExecutionKernelPort, goalId: string, claimText: string, criteria: readonly SemanticReviewCriterion[]): Promise<SemanticReview> {
  const project = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
  if (project.rowCount !== 1) throw new SemanticReviewError("Goal not found for semantic review");
  const durable = await pool.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [goalId, project.rows[0]!.project_id]);
  const durableIds = new Set(durable.rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));

  const prompt = buildSemanticReviewPrompt({ claimText, criteria, availableEvidenceIds: [...durableIds] });
  const spawned = await kernel.spawn({ name: `semantic-review:${randomUUID()}`, cwd: process.cwd() });
  let observation: InvocationObservation | undefined;
  let promptError: unknown;
  try {
    // Prime's root spawn only admits the session. Submission is a separate
    // operation and must happen before any terminal observation is trusted.
    await kernel.prompt(spawned.execution, prompt);
    observation = await observeTerminal(kernel, spawned.execution, spawned.invocation);
  } catch (error) {
    promptError = error;
  }
  const rawText = observation?.status === "succeeded" && observation.answer.state === "available"
    ? observation.answer.text
    : "";

  let verdict: SemanticReviewVerdict;
  let citedEvidenceIds: readonly string[];
  let reasoning: string | null;
  try {
    const parsed = parseSemanticReviewOutput(rawText);
    verdict = resolveSemanticReviewVerdict(parsed, durableIds);
    citedEvidenceIds = parsed.citedEvidenceIds;
    reasoning = parsed.reasoning;
  } catch (error) {
    if (!(error instanceof InvalidSemanticReviewOutputError)) throw error;
    verdict = "unsupported";
    citedEvidenceIds = [];
    reasoning = promptError instanceof Error
      ? `reviewer prompt failed: ${promptError.message}`
      : `unparseable reviewer output: ${error.message}`;
  }

  const reviewId = randomUUID();
  const inserted = await pool.query<ReviewRow>(
    `INSERT INTO semantic_reviews (review_id, goal_id, claim_text, criteria, prompt, raw_output, verdict, cited_evidence_ids, reasoning, execution_ref, invocation_ref)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10, $11)
     RETURNING review_id, goal_id, claim_text, verdict, cited_evidence_ids, reasoning`,
    [reviewId, goalId, claimText, JSON.stringify(criteria), prompt, rawText, verdict, JSON.stringify(citedEvidenceIds), reasoning, spawned.execution, spawned.invocation],
  );
  return mapReview(inserted.rows[0]!);
}

export async function listSemanticReviews(pool: Pool, goalId: string): Promise<readonly SemanticReview[]> {
  const result = await pool.query<ReviewRow>("SELECT review_id, goal_id, claim_text, verdict, cited_evidence_ids, reasoning FROM semantic_reviews WHERE goal_id = $1 ORDER BY created_at", [goalId]);
  return result.rows.map(mapReview);
}
