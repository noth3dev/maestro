import type { SpawnWorkerInput, Worker } from "@maestro/contracts";
import type { ExecutionKernelPort } from "@maestro/domain";
import { assertProjectRole, cancelWorker, observeWorker, readDepartmentPlan, readHeadCouncil, readWorker, spawnWorker, type CouncilActorContext, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface WorkerService {
  spawn(councilId: string, departmentId: string, input: SpawnWorkerInput, commandId: string, operator: OperatorContext): Promise<Worker>;
  get(workerId: string, projectId: string): Promise<Worker>;
  observe(workerId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<Worker>;
  cancel(workerId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<Worker>;
}
export interface WorkerServiceDependencies {
  pool: Pool;
  kernel: ExecutionKernelPort;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}
export class WorkerProjectMismatchError extends Error {
  constructor() { super("Worker project does not match the Council project"); this.name = "WorkerProjectMismatchError"; }
}

/** Worker creation derives the actor/session from the immutable Council snapshot and scopes the spawn with the Goal lease. */
export function createWorkerService(deps: WorkerServiceDependencies): WorkerService {
  return {
    async spawn(councilId, departmentId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const council = await readHeadCouncil(deps.pool, councilId);
      if (council.snapshot.projectId !== input.projectId) throw new WorkerProjectMismatchError();
      const plan = await readDepartmentPlan(deps.pool, councilId, departmentId);
      if (plan.projectId !== input.projectId || plan.version !== input.planVersion) throw new WorkerProjectMismatchError();
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Department is not a captured Head Council participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => spawnWorker(deps.pool, deps.kernel, { councilId, departmentId, planVersion: input.planVersion, itemId: input.itemId, commandId }, proof, context));
    },
    async get(workerId, projectId) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      return worker;
    },
    async observe(workerId, projectId, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Worker department is not a captured Head participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => observeWorker(deps.pool, deps.kernel, workerId, proof, context));
    },
    async cancel(workerId, projectId, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Worker department is not a captured Head participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => cancelWorker(deps.pool, deps.kernel, workerId, proof, context));
    },
  };
}
