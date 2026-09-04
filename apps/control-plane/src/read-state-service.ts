import type { Pool } from "pg";
import type { GoalBudgetSummary, GoalResult } from "@maestro/contracts";
import { listMetronomeChallenges, listEncoreCouncilRounds, listQualityCertifications, listConditionalCertifications, readConcertmasterFinalReport, type MetronomeChallenge, type EncoreCouncilRound, type QualityCertification, type ConditionalCertification, type ConcertmasterFinalReport } from "@maestro/persistence";

export class ReadStateGoalNotFoundError extends Error {}
export interface ReadStateService {
  listGoals(projectId: string): Promise<readonly GoalResult[]>;
  getBudgetSummary(goalId: string, projectId: string): Promise<GoalBudgetSummary>;
  listMetronomeChallenges(goalId: string, projectId: string): Promise<readonly MetronomeChallenge[]>;
  listEncoreCouncilRounds(goalId: string, projectId: string): Promise<readonly EncoreCouncilRound[]>;
  listCertifications(goalId: string, projectId: string): Promise<readonly (QualityCertification & { kind: "quality" } | ConditionalCertification)[]>;
  getConcertmasterReport(goalId: string, projectId: string): Promise<ConcertmasterFinalReport | undefined>;
}

export function createReadStateService(pool: Pool): ReadStateService {
  async function assertGoalProject(goalId: string, projectId: string): Promise<void> {
    const result = await pool.query("SELECT 1 FROM goals WHERE goal_id = $1 AND project_id = $2", [goalId, projectId]);
    if (result.rowCount !== 1) throw new ReadStateGoalNotFoundError();
  }
  return {
    async listGoals(projectId) {
      const result = await pool.query<{ goal_id: string; project_id: string; task_contract_id: string | null; state: GoalResult["state"]; version: string }>(
        "SELECT goal_id, project_id, task_contract_id, state, version FROM goals WHERE project_id = $1 ORDER BY created_at, goal_id", [projectId],
      );
      return result.rows.map((row) => ({ goalId: row.goal_id, projectId: row.project_id, state: row.state, version: Number(row.version), ...(row.task_contract_id === null ? {} : { contractId: row.task_contract_id }) }));
    },
    async getBudgetSummary(goalId, projectId) {
      await assertGoalProject(goalId, projectId);
      const envelope = await pool.query<{ amount_cents: string }>("SELECT amount_cents FROM budget_reservations WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC, reservation_id DESC LIMIT 1", [goalId]);
      const reserved = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM budget_reservations WHERE goal_id = $1 AND scope <> 'goal'", [goalId]);
      const cost = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM goal_actual_costs WHERE goal_id = $1", [goalId]);
      return { goalId, projectId, budgetCents: Number(envelope.rows[0]?.amount_cents ?? 0), reservedCents: Number(reserved.rows[0]!.total), costCents: Number(cost.rows[0]!.total) };
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
  };
}
