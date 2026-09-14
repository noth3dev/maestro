import { parsePersonaGoalEvidence, type PersonaGoalEvidence, type PersonaGoalEvidenceInput } from "@carnegie/domain";
import { assertProjectRole, capturePersonaGoalEvidence, type OperatorContext } from "@carnegie/persistence";
import type { Pool } from "pg";

export interface PersonaGoalEvidenceService {
  capture(goalId: string, input: unknown, operator: OperatorContext): Promise<PersonaGoalEvidence>;
}
export interface PersonaGoalEvidenceServiceDependencies { pool: Pool; }
export class PersonaGoalEvidenceServiceError extends Error {
  constructor(message: string) { super(message); this.name = "PersonaGoalEvidenceServiceError"; }
}

/** Authenticated control-plane boundary for complete post-Goal profile evidence. */
export function createPersonaGoalEvidenceService(deps: PersonaGoalEvidenceServiceDependencies): PersonaGoalEvidenceService {
  return {
    async capture(goalId, input, operator) {
      let payload: PersonaGoalEvidenceInput;
      try { payload = parsePersonaGoalEvidence(input); } catch (error) { throw new PersonaGoalEvidenceServiceError(error instanceof Error ? error.message : "Invalid persona Goal evidence"); }
      if (payload.goalId !== goalId) throw new PersonaGoalEvidenceServiceError("persona Goal evidence route does not match payload Goal");
      const role = await deps.pool.query<{ department_id: string | null; role_kind: string }>("SELECT department_id, role_kind FROM permanent_roles WHERE role_id = $1", [payload.roleId]);
      if (role.rowCount !== 1) throw new PersonaGoalEvidenceServiceError("persona Goal evidence role is not a persistent role");
      if (role.rows[0]!.department_id === null) throw new PersonaGoalEvidenceServiceError("persona Goal evidence currently requires a participating Department Head role");
      const requiredRole = `head-${role.rows[0]!.department_id}`;
      await assertProjectRole(deps.pool, operator.operatorId, payload.projectId, requiredRole);
      return capturePersonaGoalEvidence(deps.pool, payload);
    },
  };
}
