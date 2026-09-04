import type { EncoreCouncilResult, EncoreReviewInput } from "@maestro/contracts";
import type { ExecutionKernelPort } from "@maestro/domain";
import { runEncoreCouncilReview } from "@maestro/persistence";
import type { Pool } from "pg";

export interface EncoreService { review(goalId: string, input: EncoreReviewInput, commandId: string): Promise<EncoreCouncilResult>; }
export interface EncoreServiceDependencies { pool: Pool; kernel: ExecutionKernelPort; withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>; }
export class EncoreProjectMismatchError extends Error { constructor() { super("Encore review project does not match the Goal project"); this.name = "EncoreProjectMismatchError"; } }
export function createEncoreService(deps: EncoreServiceDependencies): EncoreService {
  return { async review(goalId, input, commandId) {
    const result = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
    if (result.rowCount !== 1 || result.rows[0]!.project_id !== input.projectId) throw new EncoreProjectMismatchError();
    return deps.withGoalLease(goalId, (proof) => runEncoreCouncilReview(deps.pool, deps.kernel, { goalId, proof, commandId, question: input.question, criteria: input.criteria, evidenceIds: input.evidenceIds, reviewerCount: input.reviewerCount }));
  } };
}
