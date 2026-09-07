import type { SpawnWorkerInput, Worker } from "@maestro/contracts";
import type { ExecutionKernelPort } from "@maestro/domain";
import { assertProjectRole, cancelWorker, countActiveWorkersForProject, observeWorker, readDepartmentPlan, readHeadCouncil, readWorker, spawnWorker, type CouncilActorContext, type OperatorContext } from "@maestro/persistence";
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
  /**
   * Phase 5 capacity-model first slice: a project-wide worker-slot ceiling. Absent by default
   * (unlimited, matching current behavior); set to enable admission control. A future revision
   * may partition this by risk class per plan/phase5.md's capacity model instead of one flat cap.
   */
  maxConcurrentWorkersPerProject?: number;
}
export class WorkerProjectMismatchError extends Error {
  constructor() { super("Worker project does not match the Council project"); this.name = "WorkerProjectMismatchError"; }
}
export class WorkerCapacityExceededError extends Error {
  constructor(limit: number) { super(`Project worker capacity is exhausted (limit ${limit}); queue and retry once a worker slot frees`); this.name = "WorkerCapacityExceededError"; }
}

/** Keep provider/process ownership internals out of the current public Worker wire contract. */
function toApiWorker(worker: Awaited<ReturnType<typeof readWorker>>): Worker {
  return {
    workerId: worker.workerId, councilId: worker.councilId, departmentId: worker.departmentId, planVersion: worker.planVersion, itemId: worker.itemId,
    bundleContentHash: worker.bundleContentHash, attempt: worker.attempt, executionRef: worker.executionRef, invocationRef: worker.invocationRef,
    status: worker.status, answerText: worker.answerText, usageTotalTokens: worker.usageTotalTokens,
  };
}

/** Worker creation derives the actor/session from the immutable Council snapshot and scopes the spawn with the Goal lease. */
export function createWorkerService(deps: WorkerServiceDependencies): WorkerService {
  return {
    async spawn(councilId, departmentId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      if (deps.maxConcurrentWorkersPerProject !== undefined) {
        const active = await countActiveWorkersForProject(deps.pool, input.projectId);
        if (active >= deps.maxConcurrentWorkersPerProject) throw new WorkerCapacityExceededError(deps.maxConcurrentWorkersPerProject);
      }
      const council = await readHeadCouncil(deps.pool, councilId);
      if (council.snapshot.projectId !== input.projectId) throw new WorkerProjectMismatchError();
      const plan = await readDepartmentPlan(deps.pool, councilId, departmentId);
      if (plan.projectId !== input.projectId || plan.version !== input.planVersion) throw new WorkerProjectMismatchError();
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Department is not a captured Head Council participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => spawnWorker(deps.pool, deps.kernel, { councilId, departmentId, planVersion: input.planVersion, itemId: input.itemId, commandId, ...(input.model === undefined ? {} : { modelRef: input.model }) }, proof, context).then(toApiWorker));
    },
    async get(workerId, projectId) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      return toApiWorker(worker);
    },
    async observe(workerId, projectId, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Worker department is not a captured Head participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => observeWorker(deps.pool, deps.kernel, workerId, proof, context).then(toApiWorker));
    },
    async cancel(workerId, projectId, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Worker department is not a captured Head participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => cancelWorker(deps.pool, deps.kernel, workerId, proof, context).then(toApiWorker));
    },
  };
}
