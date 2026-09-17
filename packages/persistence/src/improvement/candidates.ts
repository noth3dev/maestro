import { randomUUID } from "node:crypto";
import {
  CandidateRow,
  COLUMNS,
  authorValue,
  normalizeInput,
  operationRef,
  mapRow,
  assertReadAccess,
  readRow,
  assertIdempotentReplay,
  insertCandidate,
  ensureProofMatches,
  appendFromPrevious,
} from "./shared.js";
import {
  ImprovementCandidatePersistenceError,
  type ImprovementCandidateAuthor,
  type ImprovementCandidateReadAuthorization,
} from "./types.js";
import { type ImprovementCandidate, type ImprovementCandidateInput } from "@maestro/domain";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "../commands.js";
import { withGoalAuthority } from "../goal-authority.js";

/** Record the initial candidate version. The sourceEvidenceIds are durable Improvement Digest ids. */
export async function recordImprovementCandidate(
  pool: Pool,
  rawInput: ImprovementCandidateInput,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  idempotencyKey: string,
): Promise<ImprovementCandidate> {
  const input = normalizeInput(rawInput);
  authorValue(author);
  ensureProofMatches(input, proof);
  const operation = operationRef("record", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [
      operation,
    ]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      assertIdempotentReplay(row, input, author, "candidate");
      return mapRow(row);
    }
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [input.goalId]);
    if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId)
      throw new ImprovementCandidatePersistenceError("Improvement Candidate Goal/project binding is invalid");
    const candidateId = randomUUID();
    return insertCandidate(client, input, proof, author, operation, {
      candidateId,
      lineageId: candidateId,
      version: 1,
      parentCandidateId: null,
      state: "candidate",
    });
  });
}

export async function readImprovementCandidate(
  pool: Pool,
  candidateId: string,
  authorization: ImprovementCandidateReadAuthorization,
): Promise<ImprovementCandidate> {
  const row = await readRow(pool, candidateId);
  await assertReadAccess(pool, row, authorization);
  return mapRow(row);
}

export async function listImprovementCandidateVersions(
  pool: Pool,
  candidateId: string,
  authorization: ImprovementCandidateReadAuthorization,
): Promise<readonly ImprovementCandidate[]> {
  const first = await readRow(pool, candidateId);
  await assertReadAccess(pool, first, authorization);
  const result = await pool.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE lineage_id = $1 ORDER BY version`, [
    first.lineage_id,
  ]);
  return result.rows.map(mapRow);
}

export async function appendImprovementCandidateVersion(
  pool: Pool,
  candidateId: string,
  rawInput: ImprovementCandidateInput,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  idempotencyKey: string,
): Promise<ImprovementCandidate> {
  const input = normalizeInput(rawInput);
  authorValue(author);
  ensureProofMatches(input, proof);
  const operation = operationRef("append", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [
      operation,
    ]);
    if (existing.rowCount === 1) {
      assertIdempotentReplay(existing.rows[0]!, input, author, "candidate", candidateId);
      return mapRow(existing.rows[0]!);
    }
    const previous = await readRow(client, candidateId, true);
    return appendFromPrevious(client, previous, input, proof, author, operation, "candidate");
  });
}
