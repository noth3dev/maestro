import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, parsePersonaGoalEvidence, type PersonaGoalEvidence, type PersonaGoalEvidenceInput } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";

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
  if (payload.projectId !== row.project_id || payload.goalId !== row.goal_id || payload.roleId !== row.role_id || payload.taskClass !== row.task_class || payload.taskContractVersion !== row.task_contract_version || payload.activeProfileVersion !== row.active_profile_version) throw new PersonaGoalEvidenceConflictError("persona Goal evidence identity does not match its durable payload");
  return Object.freeze({ ...payload, evidenceId: row.evidence_id, createdAt: row.created_at.toISOString() });
}

async function loadEvidence(client: PoolClient, evidenceId: string): Promise<EvidenceRow> {
  const result = await client.query<EvidenceRow>(`SELECT evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at FROM persona_goal_evidence WHERE evidence_id = $1`, [evidenceId]);
  if (result.rowCount !== 1) throw new PersonaGoalEvidenceNotFoundError(`Persona Goal evidence not found: ${evidenceId}`);
  return result.rows[0]!;
}

/** Capture the complete measured outcome for one real Goal and persistent role. */
export async function capturePersonaGoalEvidence(pool: Pool, input: PersonaGoalEvidenceInput): Promise<PersonaGoalEvidence> {
  const payload = parsePersonaGoalEvidence(input);
  const payloadHash = hash(payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [payload.goalId]);
    if (goal.rowCount !== 1) throw new PersonaGoalEvidenceError(`Goal not found: ${payload.goalId}`);
    if (goal.rows[0]!.project_id !== payload.projectId) throw new PersonaGoalEvidenceError("persona Goal evidence project does not match Goal project");
    const role = await client.query("SELECT 1 FROM permanent_roles WHERE role_id = $1 FOR KEY SHARE", [payload.roleId]);
    if (role.rowCount !== 1) throw new PersonaGoalEvidenceError(`Permanent role not found: ${payload.roleId}`);
    const inserted = await client.query<EvidenceRow>(
      `INSERT INTO persona_goal_evidence
         (evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       ON CONFLICT (goal_id, role_id, task_class, payload_hash) DO NOTHING
       RETURNING evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at`,
      [randomUUID(), payload.projectId, payload.goalId, payload.roleId, payload.taskClass, payload.taskContractVersion, payload.activeProfileVersion, JSON.stringify(payload.missionOverlay), JSON.stringify(payload), payloadHash],
    );
    const row = inserted.rowCount === 1 ? inserted.rows[0]! : await loadEvidence(client, (await client.query<{ evidence_id: string }>(
      `SELECT evidence_id FROM persona_goal_evidence WHERE goal_id = $1 AND role_id = $2 AND task_class = $3 AND payload_hash = $4`, [payload.goalId, payload.roleId, payload.taskClass, payloadHash],
    )).rows[0]!.evidence_id);
    await client.query("COMMIT");
    return mapEvidence(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function readPersonaGoalEvidence(pool: Pool, evidenceId: string): Promise<PersonaGoalEvidence> {
  const result = await pool.query<EvidenceRow>(`SELECT evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at FROM persona_goal_evidence WHERE evidence_id = $1`, [evidenceId]);
  if (result.rowCount !== 1) throw new PersonaGoalEvidenceNotFoundError(`Persona Goal evidence not found: ${evidenceId}`);
  return mapEvidence(result.rows[0]!);
}

export async function listPersonaGoalEvidence(pool: Pool, goalId: string): Promise<readonly PersonaGoalEvidence[]> {
  const result = await pool.query<EvidenceRow>(`SELECT evidence_id, project_id, goal_id, role_id, task_class, task_contract_version, active_profile_version, mission_overlay, payload, payload_hash, created_at FROM persona_goal_evidence WHERE goal_id = $1 ORDER BY created_at, evidence_id`, [goalId]);
  return result.rows.map(mapEvidence);
}
