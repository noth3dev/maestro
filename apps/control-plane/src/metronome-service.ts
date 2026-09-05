import type { MetronomeCorrectionInput, MetronomeFindingList, MetronomeResolutionInput, MetronomeSafePauseInput, RaiseMetronomeChallengeInput } from "@maestro/contracts";
import { METRONOME_ACTOR_ID } from "@maestro/domain";
import { readMetronomeChallenge, raiseMetronomeChallenge, requestMetronomeCorrection, requestMetronomeSafePause, resolveMetronomeChallenge, scanGoalForMetronomeFindings, type MetronomeActorContext, type MetronomeFindingRecord } from "@maestro/persistence";
import type { Pool } from "pg";

export interface MetronomeService {
  scan(goalId: string, projectId: string, commandId: string): Promise<MetronomeFindingList>;
  raise(goalId: string, input: RaiseMetronomeChallengeInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  requestCorrection(challengeId: string, input: MetronomeCorrectionInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  requestSafePause(goalId: string, challengeId: string, input: MetronomeSafePauseInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  resolve(challengeId: string, input: MetronomeResolutionInput, commandId: string, operatorId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
}
export interface MetronomeServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}
export class MetronomeProjectMismatchError extends Error { constructor() { super("Metronome project does not match the Goal project"); this.name = "MetronomeProjectMismatchError"; } }

/** Metronome is a canonical system actor; an authenticated project member may request a scan, but cannot impersonate its findings identity. */
export function createMetronomeService(deps: MetronomeServiceDependencies): MetronomeService {
  const context = (commandId: string): MetronomeActorContext => ({ actorId: METRONOME_ACTOR_ID, sessionRef: `api:${commandId}`, commandId });
  async function assertProject(goalId: string, projectId: string): Promise<void> {
    const result = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
    if (result.rowCount !== 1 || result.rows[0]!.project_id !== projectId) throw new MetronomeProjectMismatchError();
  }
  async function challengeGoal(challengeId: string, projectId: string): Promise<string> {
    const result = await deps.pool.query<{ goal_id: string; project_id: string }>(
      "SELECT c.goal_id, g.project_id FROM metronome_challenges c JOIN goals g ON g.goal_id = c.goal_id WHERE c.challenge_id = $1",
      [challengeId],
    );
    if (result.rowCount !== 1 || result.rows[0]!.project_id !== projectId) throw new MetronomeProjectMismatchError();
    return result.rows[0]!.goal_id;
  }
  return {
    async scan(goalId, projectId, commandId) {
      await assertProject(goalId, projectId);
      const findings = await deps.withGoalLease(goalId, (proof) => scanGoalForMetronomeFindings(deps.pool, goalId, proof, context(commandId)));
      return { findings };
    },
    async raise(goalId, input, commandId) {
      await assertProject(goalId, input.projectId);
      return deps.withGoalLease(goalId, (proof) => raiseMetronomeChallenge(deps.pool, goalId, input.findingIds, { reason: input.reason, evidenceReferences: input.evidenceReferences }, proof, context(commandId)));
    },
    async requestCorrection(challengeId, input, commandId) {
      const goalId = await challengeGoal(challengeId, input.projectId);
      return deps.withGoalLease(goalId, (proof) => requestMetronomeCorrection(deps.pool, challengeId, input.correctionRequest, proof, context(commandId)));
    },
    async requestSafePause(goalId, challengeId, input, commandId) {
      await assertProject(goalId, input.projectId);
      return deps.withGoalLease(goalId, (proof) => requestMetronomeSafePause(deps.pool, challengeId, input.projectId, proof, context(commandId)));
    },
    async resolve(challengeId, input, commandId, operatorId) {
      const goalId = await challengeGoal(challengeId, input.projectId);
      const actor: MetronomeActorContext = { actorId: operatorId, sessionRef: `api:${commandId}`, commandId };
      return deps.withGoalLease(goalId, (proof) => resolveMetronomeChallenge(deps.pool, challengeId, operatorId, input.reason, proof, actor));
    },
  };
}
