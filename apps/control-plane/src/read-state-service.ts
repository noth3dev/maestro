import type { Pool } from "pg";
import { listSentinelChallenges, listOverwatchCouncilRounds, listQualityCertifications, listConditionalCertifications, readSaneFinalReport, type SentinelChallenge, type OverwatchCouncilRound, type QualityCertification, type ConditionalCertification, type SaneFinalReport } from "@maestro/persistence";

export interface ReadStateService { listSentinelChallenges(goalId:string):Promise<readonly SentinelChallenge[]>; listOverwatchCouncilRounds(goalId:string):Promise<readonly OverwatchCouncilRound[]>; listCertifications(goalId:string):Promise<readonly (QualityCertification & {kind:"quality"} | ConditionalCertification)[]>; getSaneReport(goalId:string):Promise<SaneFinalReport | undefined>; }
export function createReadStateService(pool: Pool): ReadStateService {
 return {
  listSentinelChallenges: goalId => listSentinelChallenges(pool, goalId),
  listOverwatchCouncilRounds: goalId => listOverwatchCouncilRounds(pool, goalId),

  async listCertifications(goalId) { const q=await listQualityCertifications(pool,goalId); const c=await listConditionalCertifications(pool,goalId); return [...q.map(x=>({...x,kind:"quality" as const})),...c]; },
  async getSaneReport(goalId) { const row=await pool.query<{report_id:string}>("SELECT report_id FROM sane_final_reports WHERE goal_id=$1 ORDER BY created_at DESC, report_id DESC LIMIT 1",[goalId]); return row.rowCount===1 ? readSaneFinalReport(pool,row.rows[0]!.report_id) : undefined; },
 };
}
