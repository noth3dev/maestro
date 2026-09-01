import { verifyEvidenceRecord, type EvidenceContentReader, type EvidenceRecord } from "@maestro/evidence";
import type { Pool } from "pg";

export type EvidenceMetadataInput = Omit<EvidenceRecord, "createdAt">;

export async function appendEvidenceMetadata(pool: Pool, input: EvidenceMetadataInput): Promise<EvidenceRecord> {
  validate(input);
  const result = await pool.query<StoredEvidenceRecord>(
    `INSERT INTO evidence_records
       (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9, $10, $11)
     RETURNING *`,
    [input.evidenceId, input.context.correlationId, input.context.commandId, input.context.projectId, input.context.goalId,
      input.context.actorId, input.sha256, String(input.byteLength), input.kind, input.mediaType, input.retention],
  );
  return toEvidenceRecord(result.rows[0]!);
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
