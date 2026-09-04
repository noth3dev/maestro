import type { CreateDepartmentPlanInput, DepartmentPlan, ReviseDepartmentPlanInput } from "@maestro/contracts";
import { assertProjectRole, createDepartmentPlan, readDepartmentPlan, reviseDepartmentPlan, readHeadCouncil, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface DepartmentPlanService {
  create(councilId: string, departmentId: string, input: CreateDepartmentPlanInput, commandId: string, operator: OperatorContext): Promise<DepartmentPlan>;
  get(councilId: string, departmentId: string, projectId: string): Promise<DepartmentPlan>;
  revise(councilId: string, departmentId: string, input: ReviseDepartmentPlanInput, commandId: string, operator: OperatorContext): Promise<DepartmentPlan>;
}
export interface DepartmentPlanServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}
export class DepartmentPlanProjectMismatchError extends Error {
  constructor() { super("Department Plan project does not match the Council project"); this.name = "DepartmentPlanProjectMismatchError"; }
}

/** Plan writes always derive the Head actor/session from the captured Council snapshot. */
export function createDepartmentPlanService(deps: DepartmentPlanServiceDependencies): DepartmentPlanService {
  async function headContext(councilId: string, departmentId: string, commandId: string) {
    const council = await readHeadCouncil(deps.pool, councilId);
    const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
    if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Department is not a captured Head Council participant");
    return { council, context: { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId } } as const;
  }
  function assertProject(projectId: string, actual: string): void { if (projectId !== actual) throw new DepartmentPlanProjectMismatchError(); }
  return {
    async create(councilId, departmentId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const council = await readHeadCouncil(deps.pool, councilId);
      assertProject(input.projectId, council.snapshot.projectId);
      const { context } = await headContext(councilId, departmentId, commandId);
      return deps.withGoalLease(council.goalId, (proof) => createDepartmentPlan(deps.pool, { councilId, departmentId, substance: input.substance }, proof, context));
    },
    async get(councilId, departmentId, projectId) {
      const plan = await readDepartmentPlan(deps.pool, councilId, departmentId);
      assertProject(projectId, plan.projectId);
      return plan;
    },
    async revise(councilId, departmentId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const current = await readDepartmentPlan(deps.pool, councilId, departmentId);
      assertProject(input.projectId, current.projectId);
      const { context } = await headContext(councilId, departmentId, commandId);
      return deps.withGoalLease(current.goalId, (proof) => reviseDepartmentPlan(deps.pool, councilId, departmentId, input.expectedVersion, input.substance, input.reason, proof, context));
    },
  };
}
