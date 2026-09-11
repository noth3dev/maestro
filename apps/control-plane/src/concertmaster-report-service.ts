import { ConcertmasterFinalReportSchema, type ConcertmasterFinalReport } from "@maestro/contracts";
import { assertProjectRole, generateConcertmasterFinalReport, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface ConcertmasterReportService {
  generate(goalId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<ConcertmasterFinalReport>;
}

export interface ConcertmasterReportServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}

/** Generates the immutable report only through an authenticated, Goal-leased command. */
export function createConcertmasterReportService(deps: ConcertmasterReportServiceDependencies): ConcertmasterReportService {
  return {
    async generate(goalId, projectId, _commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, projectId, "concertmaster");
      const goal = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
      if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== projectId) throw new Error("Concertmaster report Goal/project mismatch");
      const report = await deps.withGoalLease(goalId, (proof) => generateConcertmasterFinalReport(deps.pool, goalId, proof));
      return ConcertmasterFinalReportSchema.parse(report);
    },
  };
}
