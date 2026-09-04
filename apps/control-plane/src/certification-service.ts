import type { AcceptWorkerInput, CertifyWorkerInput, DepartmentAcceptance, Certification } from "@maestro/contracts";
import { assertProjectRole, acceptDepartmentWorkerOutput, certifyConditional, certifyQuality, readHeadCouncil, readWorker, type CouncilActorContext, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface CertificationService {
  accept(workerId: string, input: AcceptWorkerInput, commandId: string, operator: OperatorContext): Promise<DepartmentAcceptance>;
  certify(workerId: string, input: CertifyWorkerInput, commandId: string, operator: OperatorContext): Promise<Certification>;
  certifyConditional(workerId: string, kind: "security" | "safety_compliance", input: CertifyWorkerInput, commandId: string, operator: OperatorContext): Promise<Certification>;
}
export interface CertificationServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}
export class CertificationProjectMismatchError extends Error { constructor() { super("Certification project does not match the Goal project"); this.name = "CertificationProjectMismatchError"; } }

/** Certification actors and Goal bindings are derived from the captured Council, not accepted from HTTP. */
export function createCertificationService(deps: CertificationServiceDependencies): CertificationService {
  async function workerContext(workerId: string, projectId: string, commandId: string) {
    const worker = await readWorker(deps.pool, workerId);
    const council = await readHeadCouncil(deps.pool, worker.councilId);
    if (council.snapshot.projectId !== projectId) throw new CertificationProjectMismatchError();
    const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
    if (participant === undefined || participant.headRoleId === undefined) throw new Error("Worker department is not a captured Head participant");
    return { worker, council, context: { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId } satisfies CouncilActorContext };
  }
  async function certifierContext(council: Awaited<ReturnType<typeof readHeadCouncil>>, departmentId: string, commandId: string): Promise<CouncilActorContext> {
    const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
    if (participant === undefined || participant.headRoleId === undefined) throw new Error("Certifying department is not a captured Head participant");
    return { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
  }
  return {
    async accept(workerId, input, commandId, operator) {
      const { worker, context, council } = await workerContext(workerId, input.projectId, commandId);
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${worker.departmentId}`);
      return deps.withGoalLease(council.goalId, (proof) => acceptDepartmentWorkerOutput(deps.pool, worker.workerId, { reason: input.reason }, proof, context));
    },
    async certify(workerId, input, commandId, operator) {
      const { worker, council } = await workerContext(workerId, input.projectId, commandId);
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${input.certifyingDepartmentId}`);
      const context = await certifierContext(council, input.certifyingDepartmentId, commandId);
      return deps.withGoalLease(council.goalId, async (proof) => ({ ...await certifyQuality(deps.pool, worker.workerId, input.substance, input.certifyingDepartmentId, proof, context), kind: "quality" }));
    },
    async certifyConditional(workerId, kind, input, commandId, operator) {
      const { worker, council } = await workerContext(workerId, input.projectId, commandId);
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${input.certifyingDepartmentId}`);
      const context = await certifierContext(council, input.certifyingDepartmentId, commandId);
      return deps.withGoalLease(council.goalId, async (proof) => ({ ...await certifyConditional(deps.pool, kind, worker.workerId, input.substance, input.certifyingDepartmentId, proof, context), kind }));
    },
  };
}
