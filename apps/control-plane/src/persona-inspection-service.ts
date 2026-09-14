import { assertValidImprovementCandidateInput, type ImprovementCandidate, type ImprovementCandidateInput } from "@maestro/domain";
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

function summaries(histories: readonly Awaited<ReturnType<typeof readImprovementCandidateDecisionHistory>>[]): PersonaInspection["candidates"] {
  return histories.map((history) => ({ candidate: history.candidate, candidateId: history.candidate.candidateId, version: history.candidate.version, state: history.candidate.state, changedAxes: history.candidate.changes.map((change) => change.axis), decision: history.evaluation === null ? "pending" : history.council?.finalVerdict ?? history.candidate.state, invalidated: history.candidate.state === "candidate" && history.evaluation !== null }));
}

export function createPersonaInspectionService(deps: PersonaInspectionServiceDependencies): PersonaInspectionService {
  return {
    async read(input, operator) {
      await assertProjectMembership(deps.pool, operator.operatorId, input.projectId);
      return deps.withGoalLease(input.goalId, async (proof) => {
        const active = await readActivePersonaProfile(deps.pool, input.roleId, input.taskClass);
        const rows = await deps.pool.query<{ candidate_id: string }>(`SELECT candidate_id FROM improvement_candidates WHERE project_id = $1 AND goal_id = $2 AND kind = 'persona_axis' AND target->>'roleId' = $3 AND target->>'taskClass' = $4 ORDER BY created_at, candidate_id`, [input.projectId, input.goalId, input.roleId, input.taskClass]);
        const histories = await Promise.all(rows.rows.map((row) => readImprovementCandidateDecisionHistory(deps.pool, row.candidate_id, { operatorId: operator.operatorId, proof })));
        return { roleId: input.roleId, taskClass: input.taskClass, profile: active.persona, version: active.layers.learnedProfile.version, coreIdentity: active.coreIdentity, taskClassAdjustment: active.layers.taskClassAdjustment, missionOverlay: active.layers.missionOverlay, candidates: summaries(histories), rollouts: histories.flatMap((history) => history.rollouts.map((rollout) => ({ rolloutId: rollout.rolloutId, status: rollout.status, activeCandidateId: rollout.activeCandidateId, activeVersion: rollout.activeVersion, rollbackTarget: history.explanation.rollback, evidence: rollout.history.map((event) => ({ kind: String(event.kind), evidenceId: String(event.eventId) })) }))) };
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
