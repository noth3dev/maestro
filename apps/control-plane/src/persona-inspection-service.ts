import { assertValidImprovementCandidateInput, improvementCandidateScenarioSuiteHash, SYNTHETIC_SCENARIO_SPECS, type ImprovementCandidate, type ImprovementCandidateInput } from "@maestro/domain";
import { assertProjectMembership, readActivePersonaProfile, readImprovementCandidateDecisionHistory, recordImprovementCandidate, appendImprovementCandidateVersion, type OperatorContext, type GoalLeaseProof } from "@maestro/persistence";
import type { PersonaInspection } from "@maestro/contracts";
import type { Pool } from "pg";

export class PersonaInspectionError extends Error { constructor(message: string) { super(message); this.name = "PersonaInspectionError"; } }
export interface PersonaInspectionService {
  read(input: { projectId: string; goalId: string; roleId: string; taskClass: string }, operator: OperatorContext): Promise<PersonaInspection>;
  propose(input: { projectId: string; goalId: string; candidate: unknown }, commandId: string, operator: OperatorContext): Promise<ImprovementCandidate>;
  edit(candidateId: string, input: { projectId: string; goalId: string; candidate: unknown }, commandId: string, operator: OperatorContext): Promise<ImprovementCandidate>;
}
export interface PersonaInspectionServiceDependencies { pool: Pool; withGoalLease: <T>(goalId: string, operation: (proof: GoalLeaseProof) => Promise<T>) => Promise<T>; }

function candidateInput(value: unknown, expected: { projectId: string; goalId: string; roleId?: string; taskClass?: string }): ImprovementCandidateInput {
  try { assertValidImprovementCandidateInput(value); } catch (error) { throw new PersonaInspectionError(error instanceof Error ? error.message : "Persona candidate is invalid"); }
  const candidate = value as ImprovementCandidateInput;
  if (candidate.kind !== "persona_axis") throw new PersonaInspectionError("Persona editor accepts persona-axis candidates only");
  if (candidate.projectId !== expected.projectId.toLowerCase() || candidate.goalId !== expected.goalId.toLowerCase()) throw new PersonaInspectionError("Persona candidate is outside the requested project or Goal");
  if (expected.roleId !== undefined && candidate.target.roleId !== expected.roleId) throw new PersonaInspectionError("Persona candidate role does not match the inspected role");
  if (expected.taskClass !== undefined && candidate.target.taskClass !== expected.taskClass) throw new PersonaInspectionError("Persona candidate task class does not match the inspected task class");
  if (candidate.changes.some((change) => !Number.isFinite(change.proposedValue) || !["agreeableness", "extraversion", "imagination", "realism", "conscientiousness", "caution", "initiative", "empathy", "adaptability", "sociability"].includes(change.axis as string))) throw new PersonaInspectionError("Persona candidate cannot change core identity or authority");
  return candidate;
}

export function summarizePersonaCandidateHistory(history: Awaited<ReturnType<typeof readImprovementCandidateDecisionHistory>>): PersonaInspection["candidates"][number] {
  return { candidate: history.candidate, candidateId: history.candidate.candidateId, version: history.candidate.version, state: history.candidate.state, changedAxes: history.candidate.changes.map((change) => change.axis), decision: history.evaluation === null ? "pending" : history.council?.finalVerdict ?? history.candidate.state, invalidated: history.candidate.state === "candidate" && history.evaluation !== null };
}

function summaries(histories: readonly Awaited<ReturnType<typeof readImprovementCandidateDecisionHistory>>[]): PersonaInspection["candidates"] {
  return histories.map(summarizePersonaCandidateHistory);
}

async function proposalTemplate(pool: Pool, input: { projectId: string; goalId: string; roleId: string; taskClass: string; current: number }): Promise<ImprovementCandidateInput | undefined> {
  const [digest, rollback] = await Promise.all([
    pool.query<{ digest_id: string }>("SELECT digest_id FROM improvement_digests WHERE project_id = $1 AND goal_id = $2 ORDER BY created_at DESC, digest_id DESC LIMIT 1", [input.projectId, input.goalId]),
    pool.query<{ target_candidate_id: string; target_version: number; content_hash: string }>("SELECT target_candidate_id, target_version, content_hash FROM improvement_candidate_rollback_targets WHERE project_id = $1 AND goal_id = $2 AND kind = 'persona_axis' AND role_id = $3 AND task_class = $4 ORDER BY created_at DESC, target_candidate_id DESC LIMIT 1", [input.projectId, input.goalId, input.roleId, input.taskClass]),
  ]);
  const sourceEvidenceId = digest.rows[0]?.digest_id; const target = rollback.rows[0];
  if (sourceEvidenceId === undefined || target === undefined) return undefined;
  const scenarioSuite = SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId);
  const proposed = input.current < 0.99 ? input.current + 0.01 : input.current - 0.01;
  return { schemaVersion: 1, projectId: input.projectId, goalId: input.goalId, kind: "persona_axis", target: { roleId: input.roleId, taskClass: input.taskClass }, changes: [{ axis: "caution", currentValue: input.current, proposedValue: proposed }], sourceEvidenceIds: [sourceEvidenceId], evidencePattern: "Durable improvement evidence supports a bounded persona adjustment.", predictedEffect: "Improve task-class behavior without changing core identity or authority.", expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 1 }, { name: "safety", unit: "score", direction: "maintain" }, { name: "authority", unit: "score", direction: "maintain" }], protectedMetrics: [{ name: "safety", unit: "score", minimum: 0.9 }, { name: "authority", unit: "score", minimum: 0.9 }], scenarioSuite, scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarioSuite), confidence: 0.5, dataSufficiency: { episodeCount: 1, comparableGoalCount: 1 }, rollbackTarget: { candidateId: target.target_candidate_id, version: target.target_version, contentHash: target.content_hash } };
}

export function createPersonaInspectionService(deps: PersonaInspectionServiceDependencies): PersonaInspectionService {
  return {
    async read(input, operator) {
      await assertProjectMembership(deps.pool, operator.operatorId, input.projectId);
      return deps.withGoalLease(input.goalId, async (proof) => {
        const active = await readActivePersonaProfile(deps.pool, input.roleId, input.taskClass);
        const rows = await deps.pool.query<{ candidate_id: string }>(`SELECT candidate_id FROM improvement_candidates WHERE project_id = $1 AND goal_id = $2 AND kind = 'persona_axis' AND target->>'roleId' = $3 AND target->>'taskClass' = $4 ORDER BY created_at, candidate_id`, [input.projectId, input.goalId, input.roleId, input.taskClass]);
        const histories = await Promise.all(rows.rows.map((row) => readImprovementCandidateDecisionHistory(deps.pool, row.candidate_id, { operatorId: operator.operatorId, proof })));
        const rolloutEvidence = new Map(histories.flatMap((history) => history.rollouts.map((rollout) => [rollout.rolloutId, rollout] as const)));
        const rolloutRows = await deps.pool.query<{ rollout_id: string; status: string; active_candidate_id: string; active_version: number; rollback_target: ImprovementCandidateInput["rollbackTarget"] }>(`SELECT rollout_id, status, active_candidate_id, active_version, rollback_target FROM improvement_rollouts WHERE project_id = $1 AND goal_id = $2 AND improvement_class = 'persona_axis' AND role_id = $3 AND task_class = $4 ORDER BY created_at, rollout_id`, [input.projectId, input.goalId, input.roleId, input.taskClass]);
        const template = rows.rowCount === 0 ? await proposalTemplate(deps.pool, { projectId: input.projectId, goalId: input.goalId, roleId: input.roleId, taskClass: input.taskClass, current: active.persona.caution }) : undefined;
        return { roleId: input.roleId, taskClass: input.taskClass, profile: active.persona, version: active.layers.learnedProfile.version, coreIdentity: active.coreIdentity, taskClassAdjustment: active.layers.taskClassAdjustment, missionOverlay: active.layers.missionOverlay, ...(template === undefined ? {} : { proposalTemplate: template }), candidates: summaries(histories), rollouts: rolloutRows.rows.map((row) => { const evidence = rolloutEvidence.get(row.rollout_id); return { rolloutId: row.rollout_id, status: row.status, activeCandidateId: row.active_candidate_id, activeVersion: row.active_version, rollbackTarget: row.rollback_target, evidence: evidence?.history.map((event) => ({ kind: String(event.kind), evidenceId: String(event.eventId) })) ?? [] }; }) };
      });
    },
    async propose(input, commandId, operator) {
      const candidate = candidateInput(input.candidate, { projectId: input.projectId, goalId: input.goalId });
      return deps.withGoalLease(input.goalId, (proof) => recordImprovementCandidate(deps.pool, candidate, proof, { authorId: operator.operatorId, sessionRef: `persona:${operator.credentialId}`, operatorId: operator.operatorId, operatorRoleId: "operator" }, commandId));
    },
    async edit(candidateId, input, commandId, operator) {
      const candidate = candidateInput(input.candidate, { projectId: input.projectId, goalId: input.goalId });
      return deps.withGoalLease(input.goalId, (proof) => appendImprovementCandidateVersion(deps.pool, candidateId, candidate, proof, { authorId: operator.operatorId, sessionRef: `persona:${operator.credentialId}`, operatorId: operator.operatorId, operatorRoleId: "operator" }, commandId));
    },
  };
}
