import type { CreateMissionBundleInput, IssueMissionPersonaOverlayInput, MissionBundle } from "@carnegie/contracts";
import { assertProjectRole, createMissionBundle, issueMissionPersonaOverlay, readMissionBundle, readDepartmentPlan, readHeadCouncil, type OperatorContext } from "@carnegie/persistence";
import type { MissionPersonaOverlay } from "@carnegie/domain";
import type { Pool } from "pg";

export interface MissionBundleService {
  create(councilId: string, departmentId: string, itemId: string, input: CreateMissionBundleInput, commandId: string, operator: OperatorContext): Promise<MissionBundle>;
  get(councilId: string, departmentId: string, planVersion: number, itemId: string, projectId: string): Promise<MissionBundle>;
  issuePersonaOverlay(councilId: string, departmentId: string, itemId: string, planVersion: number, input: IssueMissionPersonaOverlayInput, commandId: string, operator: OperatorContext): Promise<MissionPersonaOverlay>;
}
export interface MissionBundleServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@carnegie/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
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
    async issuePersonaOverlay(councilId, departmentId, itemId, planVersion, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const plan = await readDepartmentPlan(deps.pool, councilId, departmentId);
      if (plan.version !== planVersion || plan.projectId !== input.projectId) throw new MissionBundleProjectMismatchError();
      const { council, context } = await headContext(councilId, departmentId, commandId);
      if (council.snapshot.projectId !== input.projectId) throw new MissionBundleProjectMismatchError();
      return deps.withGoalLease(plan.goalId, (proof) => issueMissionPersonaOverlay(deps.pool, { councilId, departmentId, planVersion, itemId, inputs: input.inputs, missionLifetimeMs: input.missionLifetimeMs }, proof, context));
    },
  };
}
