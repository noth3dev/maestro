import type { MetronomeFindingList, RaiseMetronomeChallengeInput } from "@maestro/contracts";
import { METRONOME_ACTOR_ID } from "@maestro/domain";
import { raiseMetronomeChallenge, scanGoalForMetronomeFindings, type MetronomeActorContext, type MetronomeFindingRecord } from "@maestro/persistence";
import type { Pool } from "pg";

export interface MetronomeService {
  scan(goalId: string, projectId: string, commandId: string): Promise<MetronomeFindingList>;
  raise(goalId: string, input: RaiseMetronomeChallengeInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
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
  };
}
