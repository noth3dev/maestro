import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, isGoalState, isTerminalGoalState, parsePersonaGoalEvidence, type PersonaGoalEvidence, type PersonaGoalEvidenceInput } from "@maestro/domain";
import type { Pool } from "pg";
import { assertProjectMembership } from "./project-membership.js";

export class PersonaGoalEvidenceError extends Error {}
export class PersonaGoalEvidenceNotFoundError extends PersonaGoalEvidenceError {}
export class PersonaGoalEvidenceConflictError extends PersonaGoalEvidenceError {}

interface EvidenceRow {
  evidence_id: string; project_id: string; goal_id: string; role_id: string; task_class: string;
  task_contract_version: number; active_profile_version: number; mission_overlay: unknown; payload: unknown; payload_hash: Buffer; created_at: Date;
}

function hash(payload: PersonaGoalEvidenceInput): Buffer { return createHash("sha256").update(canonicalJson(payload)).digest(); }
function mapEvidence(row: EvidenceRow): PersonaGoalEvidence {
  const payload = parsePersonaGoalEvidence(row.payload);
  const storedHash = Buffer.isBuffer(row.payload_hash) ? row.payload_hash : Buffer.from(row.payload_hash);
  if (!storedHash.equals(hash(payload))) throw new PersonaGoalEvidenceConflictError("persona Goal evidence payload hash does not match its durable row");
  if (payload.projectId !== row.project_id || payload.goalId !== row.goal_id || payload.roleId !== row.role_id || payload.taskClass !== row.task_class || payload.taskContractVersion !== row.task_contract_version || payload.activeProfileVersion !== row.active_profile_version) throw new PersonaGoalEvidenceConflictError("persona Goal evidence identity does not match its durable payload");
  return Object.freeze({ ...payload, evidenceId: row.evidence_id, createdAt: row.created_at.toISOString() });
}

/** Capture the complete measured outcome for one real Goal and persistent role. */
export async function capturePersonaGoalEvidence(pool: Pool, input: PersonaGoalEvidenceInput): Promise<PersonaGoalEvidence> {
  const payload = parsePersonaGoalEvidence(input);
  const payloadHash = hash(payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const goal = await client.query<{ project_id: string; state: string }>("SELECT project_id, state FROM goals WHERE goal_id = $1 FOR KEY SHARE", [payload.goalId]);
    if (goal.rowCount !== 1) throw new PersonaGoalEvidenceError(`Goal not found: ${payload.goalId}`);
    if (goal.rows[0]!.project_id !== payload.projectId) throw new PersonaGoalEvidenceError("persona Goal evidence project does not match Goal project");
    if (!isGoalState(goal.rows[0]!.state) || !isTerminalGoalState(goal.rows[0]!.state)) throw new PersonaGoalEvidenceError("persona Goal evidence can only be captured after a terminal Goal state");
    const contract = await client.query(
      `SELECT 1 FROM head_councils h JOIN task_contracts t ON t.contract_id = h.contract_id
        WHERE h.goal_id = $1 AND t.version = $2 FOR KEY SHARE`, [payload.goalId, payload.taskContractVersion],
    );
    if (contract.rowCount !== 1) throw new PersonaGoalEvidenceError("persona Goal evidence Task Contract version is not bound to the Goal");
    const participation = await client.query(
      `SELECT 1 FROM goal_head_participations p
         JOIN head_councils h ON h.goal_id = p.goal_id
         JOIN permanent_roles r ON r.department_id = p.department_id AND r.role_id = $2 AND r.role_kind = 'department_head'
        WHERE p.goal_id = $1 AND h.contract_id IS NOT NULL FOR KEY SHARE`,
      [payload.goalId, payload.roleId],
    );
    if (participation.rowCount !== 1) throw new PersonaGoalEvidenceError("persona Goal evidence role did not participate in the Goal");
    const profile = await client.query("SELECT 1 FROM persona_profile_versions WHERE role_id = $1 AND version = $2 FOR KEY SHARE", [payload.roleId, payload.activeProfileVersion]);
    if (profile.rowCount !== 1) throw new PersonaGoalEvidenceError("persona Goal evidence active profile version is not durable for the role");
    const role = await client.query("SELECT 1 FROM permanent_roles WHERE role_id = $1 FOR KEY SHARE", [payload.roleId]);
    if (role.rowCount !== 1) throw new PersonaGoalEvidenceError(`Permanent role not found: ${payload.roleId}`);
    const inserted = await client.query<EvidenceRow>(
      `INSERT INTO persona_goal_evidence
         (evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       ON CONFLICT (goal_id, role_id, task_class) DO NOTHING
       RETURNING evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at`,
      [randomUUID(), payload.projectId, payload.goalId, payload.roleId, payload.taskClass, payload.taskContractVersion, payload.activeProfileVersion, JSON.stringify(payload.missionOverlay), JSON.stringify(payload), payloadHash],
    );
    let row: EvidenceRow;
    if (inserted.rowCount === 1) row = inserted.rows[0]!;
    else {
      const existing = await client.query<EvidenceRow>(
        `SELECT evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at
           FROM persona_goal_evidence WHERE goal_id = $1 AND role_id = $2 AND task_class = $3 FOR UPDATE`,
        [payload.goalId, payload.roleId, payload.taskClass],
      );
      if (existing.rowCount !== 1) throw new PersonaGoalEvidenceConflictError("persona Goal evidence idempotency conflict did not resolve to a durable row");
      row = existing.rows[0]!;
      const priorHash = Buffer.isBuffer(row.payload_hash) ? row.payload_hash : Buffer.from(row.payload_hash);
      if (!priorHash.equals(payloadHash)) throw new PersonaGoalEvidenceConflictError("persona Goal evidence already exists with different content");
    }
    await client.query("COMMIT");
    return mapEvidence(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export interface PersonaGoalEvidenceReadAuthorization {
  readonly operatorId: string;
  readonly projectId: string;
  readonly goalId: string;
}

export async function readPersonaGoalEvidence(pool: Pool, evidenceId: string, authorization: PersonaGoalEvidenceReadAuthorization): Promise<PersonaGoalEvidence> {
  if (!authorization || typeof authorization.operatorId !== "string" || typeof authorization.projectId !== "string" || typeof authorization.goalId !== "string" || authorization.operatorId.trim() === "" || authorization.projectId.trim() === "" || authorization.goalId.trim() === "") throw new PersonaGoalEvidenceError("persona Goal evidence read authorization is required");
  await assertProjectMembership(pool, authorization.operatorId, authorization.projectId);
  const result = await pool.query<EvidenceRow>(`SELECT evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at FROM persona_goal_evidence WHERE evidence_id = $1 AND project_id = $2 AND goal_id = $3`, [evidenceId, authorization.projectId, authorization.goalId]);
  if (result.rowCount !== 1) throw new PersonaGoalEvidenceNotFoundError(`Persona Goal evidence not found: ${evidenceId}`);
  return mapEvidence(result.rows[0]!);
}

export async function listPersonaGoalEvidence(pool: Pool, goalId: string, authorization: PersonaGoalEvidenceReadAuthorization): Promise<readonly PersonaGoalEvidence[]> {
  if (!authorization || typeof authorization.operatorId !== "string" || typeof authorization.projectId !== "string" || typeof authorization.goalId !== "string" || authorization.operatorId.trim() === "" || authorization.projectId.trim() === "" || authorization.goalId.trim() === "") throw new PersonaGoalEvidenceError("persona Goal evidence list authorization is required");
  await assertProjectMembership(pool, authorization.operatorId, authorization.projectId);
  if (authorization.goalId.toLowerCase() !== goalId.toLowerCase()) throw new PersonaGoalEvidenceNotFoundError(`Persona Goal evidence Goal not found: ${goalId}`);
  const result = await pool.query<EvidenceRow>(`SELECT evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at FROM persona_goal_evidence WHERE goal_id = $1 AND project_id = $2 ORDER BY created_at, evidence_id`, [goalId, authorization.projectId]);
  return result.rows.map(mapEvidence);
}
