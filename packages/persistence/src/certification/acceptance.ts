import { randomUUID } from "node:crypto";
import { assertValidDepartmentAcceptanceSubstance, type DepartmentAcceptanceSubstance } from "@maestro/domain";
import type { GoalLeaseProof } from "../commands.js";
import { readHeadCouncil, type CouncilActorContext } from "../council.js";
import type { Pool } from "pg";
import { assertAuthorizedDepartmentHead, assertValidLeaseProofFor, lockGoalLease, mapAcceptance } from "./shared.js";
import { CertificationError, CertificationNotFoundError, type AcceptanceRow, type DepartmentAcceptance } from "./types.js";

/** The Executing Head accepts its own worker's output/integration. Requires the worker to have actually terminated successfully and have a real recorded integration commit. */
export async function acceptDepartmentWorkerOutput(
  pool: Pool,
  workerId: string,
  substance: DepartmentAcceptanceSubstance,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<DepartmentAcceptance> {
  assertValidDepartmentAcceptanceSubstance(substance);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const worker = await client.query<{ council_id: string; department_id: string; status: string }>(
      "SELECT council_id, department_id, status FROM workers WHERE worker_id = $1 FOR UPDATE", [workerId],
    );
    if (worker.rowCount !== 1) throw new CertificationNotFoundError(`Worker not found: ${workerId}`);
    const row = worker.rows[0]!;
    const council = await readHeadCouncil(pool, row.council_id);
    assertValidLeaseProofFor(council.goalId, proof);
    await lockGoalLease(client, proof);
    if (row.status !== "succeeded") throw new CertificationError("Only a worker that terminated successfully can be accepted");
    await assertAuthorizedDepartmentHead(pool, row.council_id, row.department_id, context, council, client);
    const commit = await client.query<{ commit_sha: string }>(
      "SELECT commit_sha FROM integration_commits WHERE worker_id = $1 ORDER BY recorded_at DESC LIMIT 1 FOR SHARE", [workerId],
    );
    if (commit.rowCount !== 1) throw new CertificationError("Worker has no recorded integration commit to accept");
    const inserted = await client.query<AcceptanceRow>(
      `INSERT INTO department_acceptances (acceptance_id, worker_id, commit_sha, reason, accepted_by, session_ref)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (worker_id) DO NOTHING
       RETURNING acceptance_id, worker_id, commit_sha, reason, accepted_by`,
      [randomUUID(), workerId, commit.rows[0]!.commit_sha, substance.reason.trim(), context.actorId, context.sessionRef],
    );
    if ((inserted.rowCount ?? 0) > 0) {
      await client.query("COMMIT"); open = false;
      return mapAcceptance(inserted.rows[0]!);
    }
    const existing = await client.query<AcceptanceRow>(
      "SELECT acceptance_id, worker_id, commit_sha, reason, accepted_by FROM department_acceptances WHERE worker_id = $1 FOR SHARE", [workerId],
    );
    if ((existing.rowCount ?? 0) !== 1) throw new CertificationError("Worker output acceptance could not be resolved after a concurrent insert");
    const prior = existing.rows[0]!;
    if (prior.reason === substance.reason.trim()) {
      await client.query("COMMIT"); open = false;
      return mapAcceptance(prior);
    }
    throw new CertificationError("Worker output was already accepted with a different reason");
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
