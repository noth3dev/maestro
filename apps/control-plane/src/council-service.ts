import type {
  CreateHeadCouncilInput,
  HeadCouncilDecisionInput,
  HeadCouncil,
  SubmitCouncilBriefInput,
} from "@maestro/contracts";
import { assertProjectRole, readHeadCouncil, createHeadCouncil, submitIndependentBrief, revealCouncilBriefs, recordCouncilDecisionPacket, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface CouncilService {
  create(goalId: string, input: CreateHeadCouncilInput, commandId: string, operator: OperatorContext): Promise<HeadCouncil>;
  get(councilId: string, projectId: string): Promise<HeadCouncil>;
  submitBrief(councilId: string, departmentId: string, input: SubmitCouncilBriefInput, commandId: string, operator: OperatorContext): Promise<void>;
  reveal(councilId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<void>;
  decide(councilId: string, input: HeadCouncilDecisionInput, commandId: string, operator: OperatorContext): Promise<HeadCouncil>;
}

export interface CouncilServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}

export class CouncilGoalNotFoundError extends Error {
  constructor() { super("Goal was not found for Head Council"); this.name = "CouncilGoalNotFoundError"; }
}
export class CouncilProjectMismatchError extends Error {
  constructor() { super("Head Council project does not match the Goal project"); this.name = "CouncilProjectMismatchError"; }
}
export class CouncilContractMismatchError extends Error {
  constructor() { super("Head Council contract must be the Goal's launched Task Contract"); this.name = "CouncilContractMismatchError"; }
}

/**
 * The HTTP surface keeps Head identity server-derived. A project member can
 * submit protocol data, but cannot provide an actor/session pair to
 * impersonate a captured Head; the service resolves that pair from the
 * immutable Council snapshot and active Goal participation.
 */
export function createCouncilService(deps: CouncilServiceDependencies): CouncilService {
  async function goalFor(councilId: string, projectId: string) {
    const council = await readHeadCouncil(deps.pool, councilId);
    if (council.snapshot.projectId !== projectId) throw new CouncilProjectMismatchError();
    return council;
  }

  async function capturedHeadContext(councilId: string, departmentId: string, commandId: string) {
    const council = await readHeadCouncil(deps.pool, councilId);
    const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
    if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) {
      throw new Error("Department is not a captured Head Council participant");
    }
    return { council, context: { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId } } as const;
  }

  return {
    async create(goalId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, "concertmaster");
      const goal = await deps.pool.query<{ project_id: string; task_contract_id: string | null }>(
        "SELECT project_id, task_contract_id FROM goals WHERE goal_id = $1", [goalId],
      );
      if (goal.rowCount !== 1) throw new CouncilGoalNotFoundError();
      if (goal.rows[0]!.project_id !== input.projectId || goal.rows[0]!.task_contract_id !== input.contractId) throw new CouncilContractMismatchError();
      return deps.withGoalLease(goalId, (proof) => createHeadCouncil(deps.pool, {
        goalId,
        contractId: input.contractId,
        briefDeadline: input.briefDeadline,
        evidence: input.evidence,
      }, proof, { actorId: operator.operatorId, sessionRef: operator.credentialId, commandId }));
    },
    async get(councilId, projectId) {
      return goalFor(councilId, projectId);
    },
    async submitBrief(councilId, departmentId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const { council, context } = await capturedHeadContext(councilId, departmentId, commandId);
      if (council.snapshot.projectId !== input.projectId) throw new CouncilProjectMismatchError();
      await deps.withGoalLease(council.goalId, (proof) => submitIndependentBrief(deps.pool, councilId, departmentId, input.brief, proof, context));
    },
    async reveal(councilId, projectId, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, projectId, "concertmaster");
      const council = await goalFor(councilId, projectId);
      await deps.withGoalLease(council.goalId, (proof) => revealCouncilBriefs(deps.pool, councilId, proof, { actorId: operator.operatorId, sessionRef: operator.credentialId, commandId }));
    },
    async decide(councilId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, "concertmaster");
      const council = await goalFor(councilId, input.projectId);
      return deps.withGoalLease(council.goalId, (proof) => recordCouncilDecisionPacket(deps.pool, councilId, input.packet, proof, { actorId: operator.operatorId, sessionRef: operator.credentialId, commandId }));
    },
  };
}
