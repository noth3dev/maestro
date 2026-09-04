import type { Pool } from "pg";
import { listMetronomeChallenges, listEncoreCouncilRounds, listQualityCertifications, listConditionalCertifications, readConcertmasterFinalReport, type MetronomeChallenge, type EncoreCouncilRound, type QualityCertification, type ConditionalCertification, type ConcertmasterFinalReport } from "@maestro/persistence";

export class ReadStateGoalNotFoundError extends Error {}
export interface ReadStateService {
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
