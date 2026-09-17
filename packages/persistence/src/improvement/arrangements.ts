import { CandidateRow, COLUMNS, mapRow } from "./shared.js";
import { type ImprovementCandidate } from "@maestro/domain";
import type { Pool } from "pg";
import { assertProjectMembership } from "../project-membership.js";

export interface ImprovementCandidateArrangementEvaluation {
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly stages: Readonly<{ replay: string; shadow: string; synthetic: string }>;
  readonly metricDeltas: readonly {
    readonly name: string;
    readonly baseline: number;
    readonly candidate: number;
    readonly delta: number;
  }[];
}
export interface ImprovementCandidateArrangementJudgment {
  readonly modelProvider: string;
  readonly modelId: string;
  readonly verdict: "proceed" | "do_not_proceed" | "escalate";
  readonly confidence: "low" | "medium" | "high";
  readonly reasoning: string;
  readonly conditions: readonly string[];
  readonly dissentNote: string | null;
  readonly citedEvidenceIds: readonly string[];
}
export interface ImprovementCandidateArrangementCouncil {
  readonly roundId: string;
  readonly question: string;
  readonly finalVerdict: "proceed" | "do_not_proceed" | "escalate";
  readonly reviewerCount: number;
  readonly sameModelOnly: boolean;
  readonly escalated: boolean;
  readonly dissentNotes: readonly string[];
  readonly judgments: readonly ImprovementCandidateArrangementJudgment[];
}
export interface ImprovementCandidateArrangementRollout {
  readonly rolloutId: string;
  readonly status: "active" | "interrupted" | "certified" | "rolled_back";
  readonly activeCandidateId: string;
  readonly activeVersion: number;
  readonly contentHash: string;
}
export interface ImprovementCandidateArrangementRecord {
  readonly candidate: ImprovementCandidate;
  readonly evaluation: ImprovementCandidateArrangementEvaluation | null;
  readonly council: ImprovementCandidateArrangementCouncil | null;
  readonly rollout: ImprovementCandidateArrangementRollout | null;
}

type ArrangementEvaluationRow = {
  evaluation_id: string;
  evaluation_hash: string;
  replay_payload: unknown;
  synthetic_payload: unknown;
  evaluation_payload: unknown;
};
type ArrangementCouncilRow = {
  round_id: string;
  question: string;
  reviewer_count: number;
  final_verdict: string;
  same_model_only: boolean;
  escalated: boolean;
  dissent_notes: unknown;
};
export interface ArrangementCouncilApprovalRow {
  readonly council_round_id: string;
  readonly candidate_id: string;
  readonly candidate_version: number;
  readonly candidate_content_hash: string;
}
/** Stable ordering for append-only approval rows returned from multiple stores. */
export function selectArrangementCouncilApproval(
  rows: readonly ArrangementCouncilApprovalRow[],
): ArrangementCouncilApprovalRow | undefined {
  return [...rows].sort(
    (left, right) =>
      right.candidate_version - left.candidate_version ||
      right.candidate_content_hash.localeCompare(left.candidate_content_hash) ||
      left.candidate_id.localeCompare(right.candidate_id) ||
      left.council_round_id.localeCompare(right.council_round_id),
  )[0];
}
export interface ArrangementCandidateSelectionRow {
  readonly candidate_id: string;
  readonly version: number;
  readonly state: string;
}
/** Keeps latest lineage rows, rejected history, and exact active rollout targets. */
export function selectArrangementCandidateRows<T extends ArrangementCandidateSelectionRow>(
  rows: readonly T[],
  latestCandidateIds: ReadonlySet<string>,
  activeRolloutTargetKeys: ReadonlySet<string>,
): T[] {
  return rows.filter(
    (row) =>
      latestCandidateIds.has(row.candidate_id) ||
      row.state === "rejected" ||
      activeRolloutTargetKeys.has(`${row.candidate_id}:${row.version}`),
  );
}

interface ArrangementCouncilCandidateBinding {
  readonly candidateId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly kind: ImprovementCandidate["kind"];
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Matches only the canonical candidate identity embedded in a durable Council question. */
export function arrangementCouncilQuestionMatchesCandidate(question: string, candidate: ArrangementCouncilCandidateBinding): boolean {
  const pattern = new RegExp(
    String.raw`^Candidate: ${escapeRegex(candidate.candidateId)} version ${candidate.version} schemaVersion [0-9]+ contentHash ${escapeRegex(candidate.contentHash)} \(${escapeRegex(candidate.kind)}\)$`,
  );
  return question.split("\n").some((line) => pattern.test(line));
}
type ArrangementJudgmentRow = {
  model_provider: string;
  model_id: string;
  verdict: string;
  confidence: string;
  reasoning: string;
  conditions: unknown;
  dissent_note: string | null;
  cited_evidence_ids: unknown;
};

function finiteMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function metricDeltas(
  payload: unknown,
): readonly { readonly name: string; readonly baseline: number; readonly candidate: number; readonly delta: number }[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const replay = (payload as Record<string, unknown>).replay;
  if (replay === null || typeof replay !== "object" || Array.isArray(replay)) return [];
  const results = (replay as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  const totals = new Map<string, { baseline: number; candidate: number; count: number }>();
  for (const item of results) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (
      row.baseline === null ||
      typeof row.baseline !== "object" ||
      Array.isArray(row.baseline) ||
      row.candidate === null ||
      typeof row.candidate !== "object" ||
      Array.isArray(row.candidate)
    )
      continue;
    const baseline = row.baseline as Record<string, unknown>;
    const candidate = row.candidate as Record<string, unknown>;
    for (const [name, base] of Object.entries(baseline)) {
      const next = candidate[name];
      if (!finiteMetric(base) || !finiteMetric(next)) continue;
      const prior = totals.get(name) ?? { baseline: 0, candidate: 0, count: 0 };
      prior.baseline += base;
      prior.candidate += next;
      prior.count += 1;
      totals.set(name, prior);
    }
  }
  return [...totals.entries()]
    .map(([name, values]) => {
      const baseline = values.baseline / values.count;
      const candidate = values.candidate / values.count;
      return { name, baseline, candidate, delta: candidate - baseline };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
function evaluationStages(payload: unknown): Readonly<{ replay: string; shadow: string; synthetic: string }> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return { replay: "unknown", shadow: "unknown", synthetic: "unknown" };
  const value = payload as Record<string, unknown>;
  const stage = (key: string): string => {
    const item = value[key];
    return item !== null && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).status === "string"
      ? ((item as Record<string, unknown>).status as string)
      : "unknown";
  };
  return { replay: stage("replay"), shadow: stage("shadow"), synthetic: stage("synthetic") };
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function arrangementJudgment(row: ArrangementJudgmentRow): ImprovementCandidateArrangementJudgment | null {
  if (
    (row.verdict !== "proceed" && row.verdict !== "do_not_proceed" && row.verdict !== "escalate") ||
    (row.confidence !== "low" && row.confidence !== "medium" && row.confidence !== "high") ||
    row.reasoning.trim() === ""
  )
    return null;
  return {
    modelProvider: row.model_provider,
    modelId: row.model_id,
    verdict: row.verdict,
    confidence: row.confidence,
    reasoning: row.reasoning,
    conditions: stringArray(row.conditions),
    dissentNote: row.dissent_note,
    citedEvidenceIds: stringArray(row.cited_evidence_ids),
  };
}

/** Lists latest candidate versions plus every rejected version for append-only negative evidence. */
export async function listImprovementCandidateArrangements(
  pool: Pool,
  authorization: { readonly operatorId: string; readonly projectId: string },
  goalId: string,
): Promise<readonly ImprovementCandidateArrangementRecord[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertProjectMembership(client, authorization.operatorId, authorization.projectId);
    const candidateRows = await client.query<CandidateRow>(
      `SELECT ${COLUMNS}
      FROM improvement_candidates WHERE project_id = $1 AND goal_id = $2 ORDER BY lineage_id, version DESC, candidate_id ASC`,
      [authorization.projectId, goalId],
    );
    const activeRolloutTargets = await client.query<{ active_candidate_id: string; active_version: number }>(
      `SELECT DISTINCT r.active_candidate_id, r.active_version
      FROM improvement_rollouts r
      JOIN improvement_candidates target
        ON target.candidate_id = r.active_candidate_id AND target.version = r.active_version
       AND target.project_id = r.project_id AND target.goal_id = r.goal_id
      JOIN improvement_candidates source
        ON source.candidate_id = r.candidate_id AND source.lineage_id = target.lineage_id
       AND source.project_id = r.project_id AND source.goal_id = r.goal_id
      WHERE r.project_id = $1 AND r.goal_id = $2 AND r.status IN ('active', 'certified')`,
      [authorization.projectId, goalId],
    );
    const activeRolloutTargetKeys = new Set(
      activeRolloutTargets.rows.map((target) => `${target.active_candidate_id}:${target.active_version}`),
    );
    const latestCandidateIds = new Set<string>();
    const latestLineages = new Set<string>();
    for (const row of candidateRows.rows) {
      if (!latestLineages.has(row.lineage_id)) {
        latestLineages.add(row.lineage_id);
        latestCandidateIds.add(row.candidate_id);
      }
    }
    const rows = selectArrangementCandidateRows(candidateRows.rows, latestCandidateIds, activeRolloutTargetKeys);
    const records: ImprovementCandidateArrangementRecord[] = [];
    for (const row of rows) {
      const candidate = mapRow(row);
      const evaluated = await client.query<{ candidate_id: string; version: number; content_hash: string }>(
        `SELECT candidate_id, version, content_hash FROM improvement_candidates WHERE project_id = $1 AND goal_id = $2 AND lineage_id = $3 AND version <= $4 AND state = 'evaluated' ORDER BY version DESC, candidate_id ASC LIMIT 1`,
        [row.project_id, row.goal_id, row.lineage_id, row.version],
      );
      const evaluatedRow = evaluated.rows[0];
      let evaluation: ImprovementCandidateArrangementEvaluation | null = null;
      if (evaluatedRow !== undefined) {
        let evaluationRow: ArrangementEvaluationRow | undefined;
        if (candidate.kind === "persona_axis") {
          const result = await client.query<ArrangementEvaluationRow>(
            `SELECT evaluation_id, evaluation_hash, NULL::jsonb AS replay_payload, NULL::jsonb AS synthetic_payload, evaluation_payload FROM improvement_candidate_evaluations WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3 AND project_id = $4 AND goal_id = $5`,
            [evaluatedRow.candidate_id, evaluatedRow.version, evaluatedRow.content_hash, row.project_id, row.goal_id],
          );
          evaluationRow = result.rows[0];
        } else {
          const result = await client.query<ArrangementEvaluationRow>(
            `SELECT evaluation_id, evaluation_hash, replay_payload, synthetic_payload, NULL::jsonb AS evaluation_payload FROM routing_candidate_evaluations WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3 AND project_id = $4 AND goal_id = $5`,
            [evaluatedRow.candidate_id, evaluatedRow.version, evaluatedRow.content_hash, row.project_id, row.goal_id],
          );
          evaluationRow = result.rows[0];
        }
        if (evaluationRow !== undefined) {
          const payload = evaluationRow.evaluation_payload ?? {
            replay: evaluationRow.replay_payload,
            synthetic: evaluationRow.synthetic_payload,
          };
          evaluation = {
            evaluationId: evaluationRow.evaluation_id,
            evaluationHash: evaluationRow.evaluation_hash,
            stages: evaluationStages(payload),
            metricDeltas: metricDeltas(payload),
          };
        }
      }
      const councilBinding =
        evaluatedRow !== undefined && (candidate.kind === "persona_axis" || candidate.state === "rejected")
          ? evaluatedRow
          : { candidate_id: candidate.candidateId, version: candidate.version, content_hash: candidate.contentHash };
      const approvals = await client.query<ArrangementCouncilApprovalRow>(
        `SELECT council_round_id, candidate_id, candidate_version, candidate_content_hash
        FROM (
          SELECT a.council_round_id, a.candidate_id, a.candidate_version, a.candidate_content_hash, c.lineage_id, a.project_id, a.goal_id
            FROM improvement_candidate_council_approvals a JOIN improvement_candidates c ON c.candidate_id = a.candidate_id AND c.version = a.candidate_version AND c.content_hash = a.candidate_content_hash AND c.project_id = a.project_id AND c.goal_id = a.goal_id
          UNION ALL
          SELECT a.council_round_id, a.candidate_id, a.candidate_version, a.candidate_content_hash, c.lineage_id, a.project_id, a.goal_id
            FROM routing_candidate_approvals a JOIN improvement_candidates c ON c.candidate_id = a.candidate_id AND c.version = a.candidate_version AND c.content_hash = a.candidate_content_hash AND c.project_id = a.project_id AND c.goal_id = a.goal_id
        ) approvals
        WHERE lineage_id = $1 AND project_id = $2 AND goal_id = $3 AND candidate_id = $4 AND candidate_version = $5 AND candidate_content_hash = $6
        ORDER BY candidate_id ASC, candidate_version ASC, candidate_content_hash ASC, council_round_id ASC`,
        [row.lineage_id, row.project_id, row.goal_id, councilBinding.candidate_id, councilBinding.version, councilBinding.content_hash],
      );
      let council: ImprovementCandidateArrangementCouncil | null = null;
      let roundId = candidate.state === "rejected" ? undefined : selectArrangementCouncilApproval(approvals.rows)?.council_round_id;
      if (roundId === undefined) {
        const rounds = await client.query<{ round_id: string; question: string; final_verdict: "proceed" | "do_not_proceed" | "escalate" }>(
          `SELECT r.round_id, r.question, s.final_verdict
          FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id JOIN goals g ON g.goal_id = r.goal_id
          WHERE r.goal_id = $1 AND g.project_id = $2
          ORDER BY r.created_at DESC, r.round_id ASC`,
          [row.goal_id, row.project_id],
        );
        const matchedRound = rounds.rows.find(
          (round) =>
            arrangementCouncilQuestionMatchesCandidate(round.question, {
              candidateId: councilBinding.candidate_id,
              version: councilBinding.version,
              contentHash: councilBinding.content_hash,
              kind: candidate.kind,
            }) &&
            (candidate.state !== "rejected" || round.final_verdict !== "proceed"),
        );
        roundId = matchedRound?.round_id;
      }
      if (roundId !== undefined) {
        const round = await client.query<ArrangementCouncilRow>(
          `SELECT r.round_id, r.question, r.reviewer_count, s.final_verdict, s.same_model_only, s.escalated, s.dissent_notes FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id JOIN goals g ON g.goal_id = r.goal_id WHERE r.round_id = $1 AND r.goal_id = $2 AND g.project_id = $3`,
          [roundId, row.goal_id, row.project_id],
        );
        const judgmentRows = await client.query<ArrangementJudgmentRow>(
          "SELECT j.model_provider, j.model_id, j.verdict, j.confidence, j.reasoning, j.conditions, j.dissent_note, j.cited_evidence_ids FROM encore_council_judgments j JOIN encore_council_rounds r ON r.round_id = j.round_id JOIN goals g ON g.goal_id = r.goal_id WHERE j.round_id = $1 AND r.goal_id = $2 AND g.project_id = $3 ORDER BY j.reviewer_index",
          [roundId, row.goal_id, row.project_id],
        );
        const roundRow = round.rows[0];
        const judgments = judgmentRows.rows.flatMap((item) => {
          const mapped = arrangementJudgment(item);
          return mapped === null ? [] : [mapped];
        });
        if (
          roundRow !== undefined &&
          (roundRow.final_verdict === "proceed" || roundRow.final_verdict === "do_not_proceed" || roundRow.final_verdict === "escalate")
        ) {
          council = {
            roundId: roundRow.round_id,
            question: roundRow.question,
            reviewerCount: roundRow.reviewer_count,
            finalVerdict: roundRow.final_verdict,
            sameModelOnly: roundRow.same_model_only,
            escalated: roundRow.escalated,
            dissentNotes: stringArray(roundRow.dissent_notes),
            judgments,
          };
        }
      }
      const rollout = await client.query<{
        rollout_id: string;
        status: ImprovementCandidateArrangementRollout["status"];
        active_candidate_id: string;
        active_version: number;
        content_hash: string;
      }>(
        `SELECT r.rollout_id, r.status, r.active_candidate_id, r.active_version, c.content_hash
        FROM improvement_rollouts r
        JOIN improvement_candidates source ON source.candidate_id = r.candidate_id AND source.version = r.candidate_version AND source.project_id = r.project_id AND source.goal_id = r.goal_id
        JOIN improvement_candidates c ON c.candidate_id = r.active_candidate_id AND c.version = r.active_version AND c.project_id = r.project_id AND c.goal_id = r.goal_id
        WHERE r.project_id = $1 AND r.goal_id = $2 AND r.active_candidate_id = $3 AND r.active_version = $4 AND c.candidate_id = $3 AND c.content_hash = $5
        ORDER BY r.created_at DESC, r.rollout_id DESC LIMIT 1`,
        [row.project_id, row.goal_id, row.candidate_id, row.version, row.content_hash],
      );
      const rolloutRow = rollout.rows[0];
      records.push({
        candidate,
        evaluation,
        council,
        rollout:
          rolloutRow === undefined
            ? null
            : {
                rolloutId: rolloutRow.rollout_id,
                status: rolloutRow.status,
                activeCandidateId: rolloutRow.active_candidate_id,
                activeVersion: rolloutRow.active_version,
                contentHash: rolloutRow.content_hash,
              },
      });
    }
    await client.query("COMMIT");
    return records;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
