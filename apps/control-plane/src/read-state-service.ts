import type { Pool } from "pg";
import type { BillingReadModel, GoalBudgetSummary, GoalPlan, GoalResult, ArrangementsRead, ArrangementCandidate, ArrangementCouncil, ArrangementNegativeEvidence } from "@maestro/contracts";
import { listMetronomeChallenges, listEncoreCouncilRounds, listQualityCertifications, listConditionalCertifications, readConcertmasterFinalReport, readEvidenceBundle, getGoalGitIntegrationState, listWorkersForGoal, listImprovementDigests, listImprovementCandidateArrangements, readLatestGoalPlan, GoalPlanNotFoundError, type MetronomeChallenge, type EncoreCouncilRound, type QualityCertification, type ConditionalCertification, type ConcertmasterFinalReport } from "@maestro/persistence";
import type { EvidenceBundleRead, GoalGitIntegrationState } from "@maestro/contracts";
import type { ImprovementDigest, Worker } from "@maestro/domain";

export class ReadStateGoalNotFoundError extends Error {}
export interface ReadStateService {
  listGoals(projectId: string): Promise<readonly GoalResult[]>;
  getBudgetSummary(goalId: string, projectId: string): Promise<GoalBudgetSummary>;
  getBillingSummary(projectId: string): Promise<BillingReadModel>;
  listMetronomeChallenges(goalId: string, projectId: string): Promise<readonly MetronomeChallenge[]>;
  listEncoreCouncilRounds(goalId: string, projectId: string): Promise<readonly EncoreCouncilRound[]>;
  listCertifications(goalId: string, projectId: string): Promise<readonly (QualityCertification & { kind: "quality" } | ConditionalCertification)[]>;
  getConcertmasterReport(goalId: string, projectId: string): Promise<ConcertmasterFinalReport | undefined>;
  getEvidenceBundle(goalId: string, projectId: string): Promise<EvidenceBundleRead>;
  getGitIntegrationState(goalId: string, projectId: string): Promise<GoalGitIntegrationState>;
  listWorkersForGoal(goalId: string, projectId: string): Promise<readonly Worker[]>;
  listImprovementDigestsForGoal(goalId: string, projectId: string, operatorId: string): Promise<readonly ImprovementDigest[]>;
  listArrangementsForGoal(goalId: string, projectId: string, operatorId: string): Promise<ArrangementsRead>;
  /** The Heads' execution plan (newest approved, else newest), or null before they plan. */
  getGoalPlan(goalId: string, projectId: string): Promise<GoalPlan | null>;
}

function arrangementCandidate(record: Awaited<ReturnType<typeof listImprovementCandidateArrangements>>[number]): ArrangementCandidate {
  const rejectionReason = record.candidate.state === "rejected" && record.council !== null
    ? record.council.judgments.find((judgment) => judgment.verdict !== "proceed")?.reasoning ?? `Encore Council verdict: ${record.council.finalVerdict}`
    : null;
  return {
    candidateId: record.candidate.candidateId, version: record.candidate.version, parentCandidateId: record.candidate.parentCandidateId,
    projectId: record.candidate.projectId, goalId: record.candidate.goalId, kind: record.candidate.kind, state: record.candidate.state,
    target: record.candidate.target, changes: [...record.candidate.changes], sourceEvidenceIds: [...record.candidate.sourceEvidenceIds],
    predictedEffect: record.candidate.predictedEffect, contentHash: record.candidate.contentHash,
    evaluation: record.evaluation === null ? null : {
      evaluationId: record.evaluation.evaluationId, evaluationHash: record.evaluation.evaluationHash, stages: record.evaluation.stages,
      metricDeltas: record.evaluation.metricDeltas.map((delta) => ({ ...delta })),
    },
    rollout: record.rollout, rejectionReason,
  };
}
function arrangementCouncil(candidateId: string, council: NonNullable<Awaited<ReturnType<typeof listImprovementCandidateArrangements>>[number]["council"]>): ArrangementCouncil {
  return { candidateId, ...council, dissentNotes: [...council.dissentNotes], judgments: council.judgments.map((judgment) => ({ ...judgment, conditions: [...judgment.conditions], citedEvidenceIds: [...judgment.citedEvidenceIds] })) };
}
function arrangementNegativeEvidence(candidateId: string, council: Awaited<ReturnType<typeof listImprovementCandidateArrangements>>[number]["council"]): ArrangementNegativeEvidence {
  const reason = council === null ? null : council.judgments.find((judgment) => judgment.verdict !== "proceed")?.reasoning ?? `Encore Council verdict: ${council.finalVerdict}`;
  return { candidateId, state: "rejected", reason, roundId: council?.roundId ?? null, judgments: (council?.judgments ?? []).map((judgment) => ({ ...judgment, conditions: [...judgment.conditions], citedEvidenceIds: [...judgment.citedEvidenceIds] })) };
}

export function isArrangementActive(record: {
  readonly candidate: { readonly candidateId: string; readonly version: number };
  readonly rollout: { readonly status: string; readonly activeCandidateId: string; readonly activeVersion: number } | null;
}): boolean {
  return (record.rollout?.status === "active" || record.rollout?.status === "certified")
    && record.rollout.activeCandidateId === record.candidate.candidateId
    && record.rollout.activeVersion === record.candidate.version;
}

export function createReadStateService(pool: Pool): ReadStateService {
  async function assertGoalProject(goalId: string, projectId: string): Promise<void> {
    const result = await pool.query("SELECT 1 FROM goals WHERE goal_id = $1 AND project_id = $2", [goalId, projectId]);
    if (result.rowCount !== 1) throw new ReadStateGoalNotFoundError();
  }
  async function listGoals(projectId: string): Promise<readonly GoalResult[]> {
    const result = await pool.query<{ goal_id: string; project_id: string; task_contract_id: string | null; state: GoalResult["state"]; version: string }>(
      "SELECT goal_id, project_id, task_contract_id, state, version FROM goals WHERE project_id = $1 ORDER BY created_at, goal_id", [projectId],
    );
    return result.rows.map((row) => ({ goalId: row.goal_id, projectId: row.project_id, state: row.state, version: Number(row.version), ...(row.task_contract_id === null ? {} : { contractId: row.task_contract_id }) }));
  }

  async function getBudgetSummary(goalId: string, projectId: string): Promise<GoalBudgetSummary> {
    await assertGoalProject(goalId, projectId);
    const envelope = await pool.query<{ amount_cents: string }>("SELECT amount_cents FROM budget_reservations WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC, reservation_id DESC LIMIT 1", [goalId]);
    const reserved = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM budget_reservations WHERE goal_id = $1 AND scope <> 'goal'", [goalId]);
    const cost = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM goal_actual_costs WHERE goal_id = $1", [goalId]);
    return { goalId, projectId, budgetCents: Number(envelope.rows[0]?.amount_cents ?? 0), reservedCents: Number(reserved.rows[0]!.total), costCents: Number(cost.rows[0]!.total) };
  }

  return {
    async listGoals(projectId) {
      return listGoals(projectId);
    },
    async getBudgetSummary(goalId, projectId) {
      return getBudgetSummary(goalId, projectId);
    },
    async getBillingSummary(projectId) {
      const goals = await listGoals(projectId);
      const summaries = await Promise.all(goals.map((goal) => getBudgetSummary(goal.goalId, projectId)));
      const daily = await pool.query<{ date: string; cost_cents: string }>(
        `WITH bounds AS (
           SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS today
         ), days AS (
           SELECT generate_series(bounds.today - 13, bounds.today, interval '1 day')::date AS day
           FROM bounds
         )
         SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
                COALESCE(sum(cost.amount_cents), 0)::bigint AS cost_cents
         FROM days
         LEFT JOIN goals ON goals.project_id = $1
         LEFT JOIN goal_actual_costs cost
           ON cost.goal_id = goals.goal_id
          AND (cost.recorded_at AT TIME ZONE 'UTC')::date = days.day
         GROUP BY days.day
         ORDER BY days.day`,
        [projectId],
      );
      const totals = summaries.reduce((total, summary) => ({
        budgetCents: total.budgetCents + summary.budgetCents,
        reservedCents: total.reservedCents + summary.reservedCents,
        costCents: total.costCents + summary.costCents,
      }), { budgetCents: 0, reservedCents: 0, costCents: 0 });
      return {
        projectId,
        periodDays: 14 as const,
        dailySpend: daily.rows.map((row) => ({ date: row.date, costCents: Number(row.cost_cents) })),
        goals: summaries.map(({ goalId, budgetCents, reservedCents, costCents }) => ({ goalId, budgetCents, reservedCents, costCents })),
        totals,
        departmentBreakdown: { available: false as const, reason: "Actual costs are tracked at Goal scope only" },
      };
    },
    async listMetronomeChallenges(goalId, projectId) { await assertGoalProject(goalId, projectId); return listMetronomeChallenges(pool, goalId); },
    async listEncoreCouncilRounds(goalId, projectId) { await assertGoalProject(goalId, projectId); return listEncoreCouncilRounds(pool, goalId); },
    async listCertifications(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      const q = await listQualityCertifications(pool, goalId);
      const c = await listConditionalCertifications(pool, goalId);
      return [...q.map((x) => ({ ...x, kind: "quality" as const })), ...c];
    },
    async getConcertmasterReport(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      const row = await pool.query<{ report_id: string }>("SELECT report_id FROM concertmaster_final_reports WHERE goal_id = $1 ORDER BY created_at DESC, report_id DESC LIMIT 1", [goalId]);
      return row.rowCount === 1 ? readConcertmasterFinalReport(pool, row.rows[0]!.report_id) : undefined;
    },
    async getEvidenceBundle(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      const row = await pool.query<{ bundle_id: string }>("SELECT bundle_id FROM evidence_bundles WHERE goal_id = $1 ORDER BY assembled_at DESC, bundle_id DESC LIMIT 1", [goalId]);
      if (row.rowCount !== 1) throw new ReadStateGoalNotFoundError("Evidence bundle not found for Goal");
      return readEvidenceBundle(pool, row.rows[0]!.bundle_id);
    },
    async getGitIntegrationState(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      const state = await getGoalGitIntegrationState(pool, goalId);
      return { goalId, branch: state.branch ?? null, latestRevision: state.latestRevision ?? null };
    },
    async listWorkersForGoal(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      return listWorkersForGoal(pool, goalId);
    },
    async listImprovementDigestsForGoal(goalId, projectId, operatorId) {
      await assertGoalProject(goalId, projectId);
      return listImprovementDigests(pool, { operatorId, projectId }, goalId);
    },
    async listArrangementsForGoal(goalId, projectId, operatorId) {
      await assertGoalProject(goalId, projectId);
      const records = await listImprovementCandidateArrangements(pool, { operatorId, projectId }, goalId);
      const active = records.filter(isArrangementActive).map(arrangementCandidate);
      const candidates = records.filter((record) => ["candidate", "evaluated", "judged"].includes(record.candidate.state)
        && !isArrangementActive(record)).map(arrangementCandidate);
      const encoreCouncil = records.filter((record) => record.council !== null).map((record) => arrangementCouncil(record.candidate.candidateId, record.council!));
      const negativeEvidence = records.filter((record) => record.candidate.state === "rejected").map((record) => arrangementNegativeEvidence(record.candidate.candidateId, record.council));
      return { active, candidates, encoreCouncil, negativeEvidence };
    },
    async getGoalPlan(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      try {
        const plan = await readLatestGoalPlan(pool, goalId, projectId);
        return { ...plan, phases: [...plan.phases], slices: plan.slices.map((slice) => ({ ...slice, acceptance: [...slice.acceptance], dependsOn: [...slice.dependsOn] })) };
      } catch (error) {
        if (error instanceof GoalPlanNotFoundError) return null;
        throw error;
      }
    },
  };
}
