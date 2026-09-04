import { randomUUID } from "node:crypto";
import {
  assertValidEncoreJudgmentSubstance,
  evaluateEncoreTriggers,
  synthesizeEncoreJudgments,
  type ExecutionKernelPort,
  type InvocationObservation,
  type InvocationStatus,
  type SpawnedInvocation,
  type EncoreJudgmentSubstance,
  type EncoreSynthesis,
  type EncoreTriggerReason,
  type EncoreVerdict,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";

export class EncoreCouncilError extends Error {}

export interface EncoreCouncilRoundRequest {
  readonly goalId: string;
  readonly proof: GoalLeaseProof;
  /** Stable API idempotency identity; omitted for internal legacy callers. */
  readonly commandId?: string;
  readonly question: string;
  readonly criteria: readonly { readonly criterionId: string; readonly description: string }[];
  readonly evidenceIds: readonly string[];
  readonly reviewerCount: number;
}

export interface EncoreCouncilRound {
  readonly roundId: string; readonly goalId: string; readonly question: string;
  readonly criteria: readonly { readonly criterionId: string; readonly description: string }[];
  readonly evidenceIds: readonly string[]; readonly triggerReasons: readonly string[]; readonly reviewerCount: number;
  readonly judgments: readonly EncoreJudgmentSubstance[]; readonly synthesis: EncoreSynthesis;
}

export interface EncoreCouncilResult {
  readonly roundId: string;
  readonly judgments: readonly EncoreJudgmentSubstance[];
  readonly synthesis: EncoreSynthesis;
}

/** Advisory: reports which plan/phase3.md trigger conditions are currently true for this Goal, from real durable state. Does not itself gate round creation -- Concertmaster/a Head decides whether to act on it. */
async function evaluateEncoreCouncilTriggerWithClient(pool: Pick<Pool | PoolClient, "query">, goalId: string): Promise<readonly EncoreTriggerReason[]> {
  const council = await pool.query<{ decision_packet: { departmentOwnership?: readonly unknown[] } | null }>(
    "SELECT decision_packet FROM head_councils WHERE goal_id = $1 AND state = 'resolved' ORDER BY created_at DESC LIMIT 1",
    [goalId],
  );
  const departmentOwnershipCount = council.rows[0]?.decision_packet?.departmentOwnership?.length ?? 0;
  const challenges = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM metronome_challenges WHERE goal_id = $1 AND status <> 'resolved'", [goalId]);
  const reviews = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM semantic_reviews WHERE goal_id = $1 AND verdict IN ('unsupported', 'ambiguous')", [goalId]);
  return evaluateEncoreTriggers({
    departmentOwnershipCount,
    openChallengeCount: Number(challenges.rows[0]!.count),
    ambiguousOrUnsupportedReviewCount: Number(reviews.rows[0]!.count),
  });
}

/** Read-only trigger inspection; review execution itself requires a Goal lease proof. */
export async function evaluateEncoreCouncilTrigger(pool: Pool, goalId: string): Promise<readonly EncoreTriggerReason[]> {
  return evaluateEncoreCouncilTriggerWithClient(pool, goalId);
}

interface RawJudgmentOutput {
  readonly verdict: EncoreVerdict;
  readonly confidence: "low" | "medium" | "high";
  readonly reasoning: string;
  readonly conditions: readonly string[];
  readonly dissentNote: string | null;
  readonly citedEvidenceIds: readonly string[];
}

export const MAX_ENCORE_REVIEWERS = 8;
const MAX_TERMINAL_OBSERVATIONS = 8;
const OBSERVE_DEADLINE_MS = 15_000;

function isTerminalStatus(status: InvocationStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

interface TerminalObservation {
  readonly observation: InvocationObservation | undefined;
  readonly terminalConfirmed: boolean;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Observe until terminal, but never wait indefinitely on a provider. */
async function observeTerminal(
  kernel: ExecutionKernelPort,
  execution: Parameters<ExecutionKernelPort["observe"]>[0],
  invocation: Parameters<ExecutionKernelPort["cancel"]>[0],
): Promise<TerminalObservation> {
  let latest: InvocationObservation | undefined;
  const deadline = Date.now() + OBSERVE_DEADLINE_MS;
  for (let attempt = 0; attempt < MAX_TERMINAL_OBSERVATIONS; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let observations: readonly InvocationObservation[] | undefined;
    try {
      observations = await withTimeout(kernel.observe(execution), remaining);
    } catch {
      break;
    }
    if (observations === undefined) break;
    latest = observations.find((candidate) => candidate.invocation === invocation);
    if (latest && isTerminalStatus(latest.status)) return { observation: latest, terminalConfirmed: true };
  }
  return { observation: latest, terminalConfirmed: false };
}

/** Cancel once after observation is bounded, then require a terminal snapshot. */
async function cancelAndConfirmTerminal(
  kernel: ExecutionKernelPort,
  execution: Parameters<ExecutionKernelPort["observe"]>[0],
  invocation: Parameters<ExecutionKernelPort["cancel"]>[0],
): Promise<TerminalObservation> {
  await withTimeout(kernel.cancel(invocation), OBSERVE_DEADLINE_MS).catch(() => undefined);
  return observeTerminal(kernel, execution, invocation);
}

function parseJudgmentOutput(rawText: string): RawJudgmentOutput {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  if (parsed.verdict !== "proceed" && parsed.verdict !== "do_not_proceed" && parsed.verdict !== "escalate") throw new EncoreCouncilError("Invalid Encore judgment verdict");
  if (parsed.confidence !== "low" && parsed.confidence !== "medium" && parsed.confidence !== "high") throw new EncoreCouncilError("Invalid Encore judgment confidence");
  if (typeof parsed.reasoning !== "string" || parsed.reasoning.trim() === "") throw new EncoreCouncilError("Encore judgment reasoning is required");
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
 * every reviewer has either answered or reached a confirmed terminal state
 * after cancellation. Provider work runs outside Goal authority locks.
 */
type StoredEncoreResult = EncoreCouncilResult & {
  goalId: string;
  question: string;
  criteria: readonly { readonly criterionId: string; readonly description: string }[];
  evidenceIds: readonly string[];
  reviewerCount: number;
};

async function readEncoreResult(client: Pick<PoolClient, "query">, roundId: string): Promise<StoredEncoreResult | undefined> {
  const round = await client.query<{
    round_id: string;
    goal_id: string;
    question: string;
    criteria: { criterionId: string; description: string }[];
    evidence_ids: string[];
    reviewer_count: number;
    final_verdict: EncoreVerdict;
    same_model_only: boolean;
    escalated: boolean;
    dissent_notes: string[];
  }>(
    `SELECT r.round_id, r.goal_id, r.question, r.criteria, r.evidence_ids, r.reviewer_count,
            s.final_verdict, s.same_model_only, s.escalated, s.dissent_notes
       FROM encore_council_rounds r
       JOIN encore_council_syntheses s ON s.round_id = r.round_id
      WHERE r.round_id = $1`,
    [roundId],
  );
  if (round.rowCount !== 1) return undefined;
  const row = round.rows[0]!;
  const judgments = await client.query<{
    model_provider: string; model_id: string; verdict: EncoreVerdict; confidence: "low" | "medium" | "high";
    reasoning: string; conditions: string[]; dissent_note: string | null; cited_evidence_ids: string[];
  }>(
    `SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids
       FROM encore_council_judgments WHERE round_id = $1 ORDER BY reviewer_index`,
    [roundId],
  );
  return {
    roundId: row.round_id,
    goalId: row.goal_id,
    judgments: judgments.rows.map((judgment) => ({
      modelProvider: judgment.model_provider, modelId: judgment.model_id, verdict: judgment.verdict,
      confidence: judgment.confidence, reasoning: judgment.reasoning, conditions: judgment.conditions,
      dissentNote: judgment.dissent_note, citedEvidenceIds: judgment.cited_evidence_ids,
    })),
    synthesis: {
      finalVerdict: row.final_verdict, sameModelOnly: row.same_model_only,
      escalated: row.escalated, dissentNotes: row.dissent_notes,
    },
    question: row.question,
    criteria: row.criteria,
    evidenceIds: row.evidence_ids,
    reviewerCount: row.reviewer_count,
  };
}

function isSameEncoreRequest(prior: StoredEncoreResult, request: EncoreCouncilRoundRequest): boolean {
  return prior.goalId === request.goalId && prior.question === request.question &&
    prior.reviewerCount === request.reviewerCount && JSON.stringify(prior.criteria) === JSON.stringify(request.criteria) &&
    JSON.stringify(prior.evidenceIds) === JSON.stringify(request.evidenceIds);
}

async function readDurableEncoreEvidence(client: Pick<PoolClient, "query">, goalId: string): Promise<Set<string>> {
  const project = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
  const durable = await client.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [goalId, project.rows[0]!.project_id]);
  return new Set(durable.rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));
}

function assertRequestedEncoreEvidence(request: EncoreCouncilRoundRequest, durableIds: ReadonlySet<string>): void {
  for (const evidenceId of request.evidenceIds) if (!durableIds.has(evidenceId.trim())) throw new EncoreCouncilError(`Encore Council evidence reference is not durable: ${evidenceId}`);
}

export async function runEncoreCouncilReview(pool: Pool, kernel: ExecutionKernelPort, request: EncoreCouncilRoundRequest): Promise<EncoreCouncilResult> {
  if (!Number.isSafeInteger(request.reviewerCount) || request.reviewerCount < 1 || request.reviewerCount > MAX_ENCORE_REVIEWERS) {
    throw new EncoreCouncilError(`Encore Council review requires between 1 and ${MAX_ENCORE_REVIEWERS} reviewers`);
  }

  const roundId = request.commandId ?? randomUUID();
  const prepared = await withGoalAuthority(pool, request.proof, 43, async (client) => {
    const goal = await client.query("SELECT 1 FROM goals WHERE goal_id = $1", [request.goalId]);
    if (goal.rowCount !== 1) throw new EncoreCouncilError("Goal not found for Encore Council review");
    if (request.commandId !== undefined) {
      const prior = await readEncoreResult(client, roundId);
      if (prior !== undefined) {
        if (!isSameEncoreRequest(prior, request)) throw new EncoreCouncilError("Encore command identity was reused with different review content");
        return { prior: { roundId: prior.roundId, judgments: prior.judgments, synthesis: prior.synthesis } };
      }
    }

    const durableIds = await readDurableEncoreEvidence(client, request.goalId);
    assertRequestedEncoreEvidence(request, durableIds);

    const triggerReasons = await evaluateEncoreCouncilTriggerWithClient(client, request.goalId);
    const prompt = [
      "You are one of several fully independent Encore Council reviewers. You cannot see any other reviewer's answer.",
      `Question: ${request.question}`,
      `Criteria: ${request.criteria.map((criterion) => `[${criterion.criterionId}] ${criterion.description}`).join("; ")}`,
      `Evidence ids you may cite: ${request.evidenceIds.join(", ") || "(none)"}`,
      'Reply with exactly one JSON object: {"verdict":"proceed"|"do_not_proceed"|"escalate","confidence":"low"|"medium"|"high","reasoning":string,"conditions":string[],"dissentNote":string|null,"citedEvidenceIds":string[]}',
    ].join("\n");

    // This short transaction freezes the request and validates its evidence.
    // Provider fan-out starts only after withGoalAuthority commits.
    return {
      roundId,
      triggerReasons,
      prompt,
      requestedEvidenceIds: new Set(request.evidenceIds.map((evidenceId) => evidenceId.trim())),
    };
  });
  if ("prior" in prepared) return prepared.prior;

  const spawnedReviewers: SpawnedInvocation[] = [];
  const terminalConfirmations = new Map<string, boolean>();
  const judgments: (EncoreJudgmentSubstance & { executionRef: string; invocationRef: string })[] = [];
  try {
    // Admit every reviewer before prompting any reviewer. Each root is a
    // fresh, parentless execution and no database transaction is open here.
    for (let index = 0; index < request.reviewerCount; index += 1) {
      spawnedReviewers.push(await kernel.spawn({ name: `encore-review:${randomUUID()}:${index}`, cwd: process.cwd() }));
    }

    for (const spawned of spawnedReviewers) {
      const model = await kernel.getModelIdentity(spawned.execution);
      let terminal: TerminalObservation;
      let promptError: unknown;
      let promptFailed = false;
      try {
        await kernel.prompt(spawned.execution, prepared.prompt);
      } catch (error) {
        promptFailed = true;
        promptError = error;
      }
      if (promptFailed) {
        // A failed prompt can leave provider work running. Cancel it and
        // require a terminal snapshot before considering this reviewer done.
        terminal = await cancelAndConfirmTerminal(kernel, spawned.execution, spawned.invocation);
      } else {
        terminal = await observeTerminal(kernel, spawned.execution, spawned.invocation);
        if (!terminal.terminalConfirmed) terminal = await cancelAndConfirmTerminal(kernel, spawned.execution, spawned.invocation);
      }
      terminalConfirmations.set(String(spawned.invocation), terminal.terminalConfirmed);

      const observation = terminal.observation;
      const rawText = terminal.terminalConfirmed && observation?.status === "succeeded" && observation.answer.state === "available"
        ? observation.answer.text
        : "";
      let output: RawJudgmentOutput;
      try {
        output = parseJudgmentOutput(rawText);
        const invalidEvidence = output.citedEvidenceIds.find((evidenceId) => !prepared.requestedEvidenceIds.has(evidenceId.trim()));
        if (invalidEvidence !== undefined) throw new EncoreCouncilError(`Encore judgment cited evidence outside the requested durable set: ${invalidEvidence}`);
        output = { ...output, citedEvidenceIds: output.citedEvidenceIds.map((evidenceId) => evidenceId.trim()) };
      } catch (error) {
        output = {
          verdict: "escalate",
          confidence: "low",
          reasoning: promptError instanceof Error
            ? `reviewer prompt failed: ${promptError.message}`
            : !terminal.terminalConfirmed
              ? "reviewer did not reach terminal state before the observation deadline"
              : error instanceof Error
                ? `invalid reviewer output: ${error.message}`
                : "invalid reviewer output",
          conditions: [],
          dissentNote: null,
          citedEvidenceIds: [],
        };
      }
      const substance: EncoreJudgmentSubstance = {
        modelProvider: model.provider, modelId: model.id, verdict: output.verdict, confidence: output.confidence,
        reasoning: output.reasoning, conditions: output.conditions, dissentNote: output.dissentNote,
        citedEvidenceIds: output.citedEvidenceIds,
      };
      assertValidEncoreJudgmentSubstance(substance);
      judgments.push({ ...substance, executionRef: String(spawned.execution), invocationRef: String(spawned.invocation) });
    }

    const synthesis = synthesizeEncoreJudgments(judgments);
    const result: EncoreCouncilResult = {
      roundId,
      judgments: judgments.map(({ executionRef: _executionRef, invocationRef: _invocationRef, ...judgment }) => judgment),
      synthesis,
    };

    // Re-acquire authority only for this short durable write. A lease that
    // expires during provider work therefore fails closed without holding a
    // Goal lock for the duration of that work.
    const committed = await withGoalAuthority(pool, request.proof, 43, async (client) => {
      if (request.commandId !== undefined) {
        const prior = await readEncoreResult(client, roundId);
        if (prior !== undefined) {
          if (!isSameEncoreRequest(prior, request)) throw new EncoreCouncilError("Encore command identity was reused with different review content");
          return { roundId: prior.roundId, judgments: prior.judgments, synthesis: prior.synthesis };
        }
      }
      const durableIds = await readDurableEncoreEvidence(client, request.goalId);
      assertRequestedEncoreEvidence(request, durableIds);

      await client.query(
        `INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
        [roundId, request.goalId, request.question, JSON.stringify(request.criteria), JSON.stringify(request.evidenceIds), JSON.stringify(prepared.triggerReasons), request.reviewerCount],
      );
      // Sealed: every judgment is written together only after every reviewer
      // has been observed or explicitly cancellation-settled.
      for (const [index, judgment] of judgments.entries()) {
        await client.query(
          `INSERT INTO encore_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13)`,
          [randomUUID(), roundId, index, judgment.modelProvider, judgment.modelId, judgment.verdict, judgment.confidence, judgment.reasoning, JSON.stringify(judgment.conditions), judgment.dissentNote, JSON.stringify(judgment.citedEvidenceIds), judgment.executionRef, judgment.invocationRef],
        );
      }
      await client.query(
        `INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [roundId, synthesis.finalVerdict, synthesis.sameModelOnly, synthesis.escalated, JSON.stringify(synthesis.dissentNotes)],
      );
      return result;
    });

    // Release is an explicit post-durable-write acknowledgement. Do not
    // release a session whose cancellation could not be terminally confirmed.
    for (const spawned of spawnedReviewers) {
      if (terminalConfirmations.get(String(spawned.invocation)) === true) await kernel.release?.(spawned.invocation).catch(() => {});
    }
    return committed;
  } catch (error) {
    // If admission or model lookup fails before a reviewer is settled, stop
    // those provider sessions. Their records remain available for recovery
    // because no durable judgment exists to authorize release yet.
    for (const spawned of spawnedReviewers) {
      if (!terminalConfirmations.has(String(spawned.invocation))) {
        const terminal = await cancelAndConfirmTerminal(kernel, spawned.execution, spawned.invocation);
        terminalConfirmations.set(String(spawned.invocation), terminal.terminalConfirmed);
      }
    }
    throw error;
  }
}

/** Reads complete, immutable Encore rounds for one Goal. */
export async function listEncoreCouncilRounds(pool: Pool, goalId: string): Promise<readonly EncoreCouncilRound[]> {
  const rounds = await pool.query<{ round_id: string; goal_id: string; question: string; criteria: { criterionId: string; description: string }[]; evidence_ids: string[]; trigger_reasons: string[]; reviewer_count: number; final_verdict: EncoreVerdict; same_model_only: boolean; escalated: boolean; dissent_notes: string[] }>(
    `SELECT r.round_id, r.goal_id, r.question, r.criteria, r.evidence_ids, r.trigger_reasons, r.reviewer_count,
            s.final_verdict, s.same_model_only, s.escalated, s.dissent_notes
       FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id
      WHERE r.goal_id = $1 ORDER BY r.created_at, r.round_id`, [goalId],
  );
  const result: EncoreCouncilRound[] = [];
  for (const row of rounds.rows) {
    const judgments = await pool.query<{ model_provider: string; model_id: string; verdict: EncoreVerdict; confidence: "low"|"medium"|"high"; reasoning: string; conditions: string[]; dissent_note: string|null; cited_evidence_ids: string[] }>(
      `SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids
         FROM encore_council_judgments WHERE round_id = $1 ORDER BY reviewer_index`, [row.round_id],
    );
    result.push({ roundId: row.round_id, goalId: row.goal_id, question: row.question, criteria: row.criteria, evidenceIds: row.evidence_ids, triggerReasons: row.trigger_reasons, reviewerCount: row.reviewer_count, judgments: judgments.rows.map((judgment) => ({ modelProvider: judgment.model_provider, modelId: judgment.model_id, verdict: judgment.verdict, confidence: judgment.confidence, reasoning: judgment.reasoning, conditions: judgment.conditions, dissentNote: judgment.dissent_note, citedEvidenceIds: judgment.cited_evidence_ids })), synthesis: { finalVerdict: row.final_verdict, sameModelOnly: row.same_model_only, escalated: row.escalated, dissentNotes: row.dissent_notes } });
  }
  return result;
}
