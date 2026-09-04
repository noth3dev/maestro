import type { CreateMissionBundleInput, MissionBundle } from "@maestro/contracts";
import { assertProjectRole, createMissionBundle, readMissionBundle, readDepartmentPlan, readHeadCouncil, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface MissionBundleService {
  create(councilId: string, departmentId: string, itemId: string, input: CreateMissionBundleInput, commandId: string, operator: OperatorContext): Promise<MissionBundle>;
  get(councilId: string, departmentId: string, planVersion: number, itemId: string, projectId: string): Promise<MissionBundle>;
}
export interface MissionBundleServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}
export class MissionBundleProjectMismatchError extends Error {
  constructor() { super("Mission Bundle project does not match the Council project"); this.name = "MissionBundleProjectMismatchError"; }
}

/** Mission Bundle writes use the captured Head identity, never caller-supplied actor/session data. */
export function createMissionBundleService(deps: MissionBundleServiceDependencies): MissionBundleService {
  async function headContext(councilId: string, departmentId: string, commandId: string) {
    const council = await readHeadCouncil(deps.pool, councilId);
    const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
    if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Department is not a captured Head Council participant");
    return { council, context: { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId } } as const;
  }
  return {
    async create(councilId, departmentId, itemId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const plan = await readDepartmentPlan(deps.pool, councilId, departmentId);
      if (plan.projectId !== input.projectId) throw new MissionBundleProjectMismatchError();
      const { council, context } = await headContext(councilId, departmentId, commandId);
      if (council.snapshot.projectId !== input.projectId) throw new MissionBundleProjectMismatchError();
      return deps.withGoalLease(plan.goalId, (proof) => createMissionBundle(deps.pool, { councilId, departmentId, itemId, substance: input.substance }, proof, context));
    },
    async get(councilId, departmentId, planVersion, itemId, projectId) {
      const bundle = await readMissionBundle(deps.pool, councilId, departmentId, planVersion, itemId);
      const council = await readHeadCouncil(deps.pool, councilId);
      if (council.snapshot.projectId !== projectId) throw new MissionBundleProjectMismatchError();
      return bundle;
    },
  };
}
