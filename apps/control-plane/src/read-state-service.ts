import type { Pool } from "pg";
import { listSentinelChallenges, listQualityCertifications, listConditionalCertifications, readSaneFinalReport, type SentinelChallenge, type QualityCertification, type ConditionalCertification, type SaneFinalReport } from "@maestro/persistence";

export interface CouncilRound { roundId: string; goalId: string; question: string; criteria: { criterionId: string; description: string }[]; evidenceIds: string[]; triggerReasons: string[]; reviewerCount: number; judgments: { modelProvider: string; modelId: string; verdict: "proceed"|"do_not_proceed"|"escalate"; confidence: "low"|"medium"|"high"; reasoning: string; conditions: string[]; dissentNote: string|null; citedEvidenceIds: string[] }[]; synthesis: { finalVerdict: "proceed"|"do_not_proceed"|"escalate"; sameModelOnly: boolean; escalated: boolean; dissentNotes: string[] } }
export interface ReadStateService { listSentinelChallenges(goalId:string):Promise<readonly SentinelChallenge[]>; listOverwatchCouncilRounds(goalId:string):Promise<readonly CouncilRound[]>; listCertifications(goalId:string):Promise<readonly (QualityCertification & {kind:"quality"} | ConditionalCertification)[]>; getSaneReport(goalId:string):Promise<SaneFinalReport | undefined>; }
export function createReadStateService(pool: Pool): ReadStateService {
 return {
  listSentinelChallenges: goalId => listSentinelChallenges(pool, goalId),
  async listOverwatchCouncilRounds(goalId) {
   const rounds = await pool.query<any>(`SELECT r.round_id,r.goal_id,r.question,r.criteria,r.evidence_ids,r.trigger_reasons,r.reviewer_count,s.final_verdict,s.same_model_only,s.escalated,s.dissent_notes FROM overwatch_council_rounds r JOIN overwatch_council_syntheses s ON s.round_id=r.round_id WHERE r.goal_id=$1 ORDER BY r.created_at,r.round_id`,[goalId]);
   const result: CouncilRound[]=[];
   for (const r of rounds.rows) { const j=await pool.query<any>(`SELECT model_provider,model_id,verdict,confidence,reasoning,conditions,dissent_note,cited_evidence_ids FROM overwatch_council_judgments WHERE round_id=$1 ORDER BY reviewer_index`,[r.round_id]); result.push({roundId:r.round_id,goalId:r.goal_id,question:r.question,criteria:r.criteria,evidenceIds:r.evidence_ids,triggerReasons:r.trigger_reasons,reviewerCount:r.reviewer_count,judgments:j.rows.map((x:any)=>({modelProvider:x.model_provider,modelId:x.model_id,verdict:x.verdict,confidence:x.confidence,reasoning:x.reasoning,conditions:x.conditions,dissentNote:x.dissent_note,citedEvidenceIds:x.cited_evidence_ids})),synthesis:{finalVerdict:r.final_verdict,sameModelOnly:r.same_model_only,escalated:r.escalated,dissentNotes:r.dissent_notes}}); } return result;
  },
  async listCertifications(goalId) { const q=await listQualityCertifications(pool,goalId); const c=await listConditionalCertifications(pool,goalId); return [...q.map(x=>({...x,kind:"quality" as const})),...c]; },
  async getSaneReport(goalId) { const row=await pool.query<{report_id:string}>("SELECT report_id FROM sane_final_reports WHERE goal_id=$1 ORDER BY created_at DESC, report_id DESC LIMIT 1",[goalId]); return row.rowCount===1 ? readSaneFinalReport(pool,row.rows[0]!.report_id) : undefined; },
 };
}
