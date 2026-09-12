import { randomUUID } from "node:crypto";
import { verifyEvidenceRecord, type EvidenceContentReader, type EvidenceRecord } from "@maestro/evidence";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";
import { assertProjectMembership, assertProjectRole } from "./project-membership.js";

export type EvidenceMetadataInput = Omit<EvidenceRecord, "createdAt">;

export class EvidenceMetadataConflictError extends Error {
  constructor(message = "Evidence command replay conflicts with the original payload") { super(message); this.name = "EvidenceMetadataConflictError"; }
}

export async function appendEvidenceMetadata(pool: Pool, input: EvidenceMetadataInput): Promise<EvidenceRecord> {
  validate(input);
  const result = await pool.query<StoredEvidenceRecord>(
    `INSERT INTO evidence_records
       (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9, $10, $11)
     ON CONFLICT (project_id, goal_id, command_id) DO NOTHING
     RETURNING *`,
    [input.evidenceId, input.context.correlationId, input.context.commandId, input.context.projectId, input.context.goalId,
      input.context.actorId, input.sha256, String(input.byteLength), input.kind, input.mediaType, input.retention],
  );
  if (result.rows[0] !== undefined) return toEvidenceRecord(result.rows[0]);
  const existingResult = await pool.query<StoredEvidenceRecord>(
    "SELECT * FROM evidence_records WHERE project_id = $1 AND goal_id = $2 AND command_id = $3",
    [input.context.projectId, input.context.goalId, input.context.commandId],
  );
  const existing = existingResult.rows[0];
  if (existing === undefined) throw new Error("Evidence command replay could not be resolved");
  const record = toEvidenceRecord(existing);
  if (sameEvidenceMetadata(record, input)) return record;
  throw new EvidenceMetadataConflictError();
}

function sameEvidenceMetadata(existing: EvidenceRecord, input: EvidenceMetadataInput): boolean {
  return existing.context.correlationId === input.context.correlationId
    && existing.context.commandId === input.context.commandId
    && existing.context.projectId === input.context.projectId
    && existing.context.goalId === input.context.goalId
    && existing.context.actorId === input.context.actorId
    && existing.sha256 === input.sha256
    && existing.byteLength === input.byteLength
    && existing.kind === input.kind
    && existing.mediaType === input.mediaType
    && existing.retention === input.retention;
}

/** Retrieves evidence only after its durable metadata matches the immutable artifact. */
export async function getEvidenceMetadata(pool: Pool, evidenceId: string, content: EvidenceContentReader): Promise<EvidenceRecord | undefined> {
  const result = await pool.query<StoredEvidenceRecord>("SELECT * FROM evidence_records WHERE evidence_id = $1", [evidenceId]);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const record = toEvidenceRecord(row);
  await verifyEvidenceRecord(record, content);
  return record;
}

type StoredEvidenceRecord = {
  evidence_id: string; correlation_id: string; command_id: string; project_id: string; goal_id: string; actor_id: string;
  sha256: string; byte_length: string; kind: string; media_type: string; created_at: Date; retention: EvidenceRecord["retention"];
};
function toEvidenceRecord(row: StoredEvidenceRecord): EvidenceRecord {
  return {
    evidenceId: row.evidence_id,
    context: { correlationId: row.correlation_id, commandId: row.command_id, projectId: row.project_id, goalId: row.goal_id, actorId: row.actor_id },
    sha256: row.sha256,
    byteLength: Number(row.byte_length),
    kind: row.kind,
    mediaType: row.media_type,
    createdAt: row.created_at.toISOString(),
    retention: row.retention,
  };
}
function validate(input: EvidenceMetadataInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Evidence SHA-256 must be lowercase hex");
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) throw new Error("Evidence byteLength is invalid");
}


/**
 * Supported source-loss transition. Ordinary evidence deletion remains
 * forbidden; this boundary records the loss and lets the database append an
 * unsupported knowledge revision before deleting the artifact metadata.
 */
export async function deleteEvidenceSource(pool: Pool, evidenceId: string, reason: string, recordedBy: string, proof: GoalLeaseProof, operatorRoleId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidenceId) || reason.trim() === "" || reason.length > 1024 || recordedBy.trim() === "" || recordedBy.length > 256) throw new Error("source evidence loss request is invalid");
  await withGoalAuthority(pool, proof, 87, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [recordedBy]);
    if (operator.rowCount !== 1) throw new Error("source evidence loss requires an authorized operator");
    const source = await client.query<{ goal_id: string; project_id: string; goal_project_id: string }>("SELECT e.goal_id, e.project_id, g.project_id AS goal_project_id FROM evidence_records e JOIN goals g ON g.goal_id = e.goal_id WHERE e.evidence_id = $1", [evidenceId.toLowerCase()]);
    if (source.rowCount !== 1 || source.rows[0]!.goal_id !== proof.goalId || source.rows[0]!.project_id !== source.rows[0]!.goal_project_id) throw new Error("source evidence is outside the Goal lease/project");
    await assertProjectMembership(client, recordedBy, source.rows[0]!.project_id);
    await assertProjectRole(client, recordedBy, source.rows[0]!.project_id, operatorRoleId);
    const token = randomUUID();
    await client.query("SELECT authorize_source_evidence_loss($1, $2::uuid, $3::uuid, $4::uuid, $5, $6::bigint, $7, $8::uuid, $9)", [token, evidenceId.toLowerCase(), source.rows[0]!.goal_id, source.rows[0]!.project_id, proof.ownerId, proof.fencingToken, reason, recordedBy, operatorRoleId]);
    await client.query("INSERT INTO source_evidence_loss_events (event_id, evidence_id, goal_id, project_id, owner_id, fencing_token, reason, recorded_by) VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8)", [randomUUID(), evidenceId.toLowerCase(), source.rows[0]!.goal_id, source.rows[0]!.project_id, proof.ownerId, proof.fencingToken, reason, recordedBy]);
    const deleted = await client.query("DELETE FROM evidence_records WHERE evidence_id = $1", [evidenceId.toLowerCase()]);
    if (deleted.rowCount !== 1) throw new Error("source evidence was not found");
  });
}
