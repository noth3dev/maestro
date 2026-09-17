import { type MissionRepairRepetitionScope, type Worker, type WorkerStatus } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "../commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "../council.js";
import { readMissionBundle } from "../mission-bundle.js";
import { createCapabilityApproval, getCapabilityApproval, type RepetitionScope } from "../capability-approval.js";
import { WorkerError, WorkerNotFoundError } from "./types.js";

export function assertWorkerPathScope(paths: readonly string[]): void {
  for (const path of paths) {
    const parts = path.trim().split(/[\\/]/u);
    if (path.trim() === "" || path.startsWith("/") || /^[A-Za-z]:/u.test(path) || parts.includes(".."))
      throw new WorkerError("Mission Bundle path scope must be relative to the bound worker worktree");
  }
}

export interface WorkerRow {
  worker_id: string;
  council_id: string;
  department_id: string;
  plan_version: number;
  item_id: string;
  bundle_content_hash: string;
  attempt: number;
  execution_ref: string;
  invocation_ref: string;
  owner_id: string | null;
  owner_fencing_token: string | null;
  owner_lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  recovery_state: "none" | "fenced" | "provider_cancelled";
  cancellation_requested_at: Date | null;
  cancellation_owner_id: string | null;
  cancellation_fencing_token: string | null;
  status: WorkerStatus;
  answer_text: string | null;
  usage_total_tokens: number | null;
  repair_hold_expires_at: Date | null;
  repair_approval_id: string | null;
}

export const REPAIR_CAPABILITY_KIND = "worker-repair";
export const REPAIR_ACTION = "worker.requeue";

export interface RepairApprovalContext {
  readonly approvalId: string;
  readonly commandId: string;
  readonly action: string;
  readonly target: string;
  readonly capabilityKind: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly policyVersion: number;
  readonly controlEpoch: string;
}

export function repairApprovalCommandId(approvalId: string): string {
  return `worker-repair:${approvalId}`;
}
export function repairTarget(worker: WorkerRow): string {
  return `${worker.council_id}/${worker.department_id}/${worker.plan_version}/${worker.item_id}`;
}
export function repairRepetitionScope(scope: MissionRepairRepetitionScope): RepetitionScope {
  return scope.kind === "bounded_count" ? scope : { kind: "bounded_time", expiresAt: new Date(scope.expiresAt) };
}

export async function readRepairApprovalContext(pool: Pool, worker: WorkerRow, goalId: string): Promise<RepairApprovalContext> {
  const result = await pool.query<{ project_id: string; control_epoch: string }>(
    `SELECT g.project_id, gc.control_epoch
       FROM goals g JOIN goal_controls gc ON gc.goal_id = g.goal_id
      WHERE g.goal_id = $1`,
    [goalId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new WorkerError("Worker Goal control is unavailable for repair hold");
  const bundle = await readMissionBundle(pool, worker.council_id, worker.department_id, worker.plan_version, worker.item_id);
  const hold = bundle.substance.repairHold;
  if (hold === undefined) throw new WorkerError("Worker repair hold declaration is missing");
  const commandId = repairApprovalCommandId(hold.approvalId);
  return {
    approvalId: hold.approvalId,
    commandId,
    action: REPAIR_ACTION,
    target: repairTarget(worker),
    capabilityKind: REPAIR_CAPABILITY_KIND,
    projectId: row.project_id,
    goalId,
    policyVersion: worker.plan_version,
    controlEpoch: row.control_epoch,
  };
}

export async function ensureRepairApproval(
  pool: Pool,
  worker: WorkerRow,
  goalId: string,
  hold: NonNullable<Awaited<ReturnType<typeof readMissionBundle>>["substance"]["repairHold"]>,
  holdExpiresAt: Date,
): Promise<RepairApprovalContext> {
  const context = await readRepairApprovalContext(pool, worker, goalId);
  const repetitionScope = repairRepetitionScope(hold.repetitionScope);
  const scopeExpiry = repetitionScope.kind === "bounded_time" ? repetitionScope.expiresAt : undefined;
  const approvalExpiry = new Date(Math.max(holdExpiresAt.getTime(), scopeExpiry?.getTime() ?? 0, Date.now() + 1_000));
  const existing = await getCapabilityApproval(pool, context.approvalId);
  if (existing !== undefined) {
    if (
      existing.capabilityKind !== context.capabilityKind ||
      existing.projectId !== context.projectId ||
      existing.goalId !== context.goalId ||
      existing.commandId !== context.commandId ||
      existing.action !== context.action ||
      existing.target !== context.target ||
      existing.policyVersion !== context.policyVersion ||
      existing.controlEpoch !== context.controlEpoch
    )
      throw new WorkerError("Worker repair approval identity conflict");
    return context;
  }
  await createCapabilityApproval(pool, {
    approvalId: context.approvalId,
    capabilityKind: context.capabilityKind,
    projectId: context.projectId,
    goalId: context.goalId,
    commandId: context.commandId,
    action: context.action,
    target: context.target,
    policyVersion: context.policyVersion,
    controlEpoch: context.controlEpoch,
    budgetEffectCents: 0,
    tier: "Department Head",
    approverId: `mission-bundle:${worker.bundle_content_hash}`,
    decision: "approved",
    reason: "The Mission Bundle explicitly permits one bounded repair round.",
    consequence: "Only the bound worker session may receive the repair message.",
    expiresAt: approvalExpiry,
    repetitionScope,
  });
  return context;
}

export function mapWorker(row: WorkerRow): Worker {
  return {
    workerId: row.worker_id,
    councilId: row.council_id,
    departmentId: row.department_id,
    planVersion: row.plan_version,
    itemId: row.item_id,
    bundleContentHash: row.bundle_content_hash.trim(),
    attempt: row.attempt,
    executionRef: row.execution_ref,
    invocationRef: row.invocation_ref,
    ownerId: row.owner_id ?? null,
    ownerFencingToken: row.owner_fencing_token ?? null,
    ownerLeaseExpiresAt: row.owner_lease_expires_at ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    recoveryState: row.recovery_state ?? "none",
    cancellationRequestedAt: row.cancellation_requested_at ?? null,
    status: row.status,
    answerText: row.answer_text,
    usageTotalTokens: row.usage_total_tokens,
  };
}

export const WORKER_COLUMNS = [
  "worker_id",
  "council_id",
  "department_id",
  "plan_version",
  "item_id",
  "bundle_content_hash",
  "attempt",
  "execution_ref",
  "invocation_ref",
  "owner_id",
  "owner_fencing_token",
  "owner_lease_expires_at",
  "heartbeat_at",
  "recovery_state",
  "cancellation_requested_at",
  "cancellation_owner_id",
  "cancellation_fencing_token",
  "status",
  "answer_text",
  "usage_total_tokens",
  "repair_hold_expires_at",
  "repair_approval_id",
] as const;

export function workerSelectSql(): string {
  return `SELECT ${WORKER_COLUMNS.join(", ")} FROM workers`;
}

export function workerSelectWithGoalSql(): string {
  return `SELECT ${WORKER_COLUMNS.map((column) => `w.${column}`).join(", ")}, hc.goal_id
    FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id`;
}

export async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<Date> {
  const lease = await client.query<{ expires_at: Date }>(
    "SELECT expires_at FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE",
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 16))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
  return lease.rows[0]!.expires_at;
}

/** Run a durable worker mutation only while the supplied Goal lease is live. */
export async function withWorkerLease<T>(
  pool: Pool,
  workerId: string,
  proof: GoalLeaseProof,
  action: (client: PoolClient, worker: WorkerRow) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await lockGoalLease(client, proof);
    const current = await client.query<WorkerRow & { goal_id: string }>(workerSelectWithGoalSql() + " WHERE w.worker_id = $1 FOR UPDATE", [
      workerId,
    ]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    if (current.rows[0]!.goal_id !== proof.goalId) throw new StaleGoalLeaseError(proof.goalId);
    const result = await action(client, current.rows[0]!);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assertWorkerAuthorization(
  pool: Pool,
  client: PoolClient,
  worker: WorkerRow,
  proof?: GoalLeaseProof,
  context?: CouncilActorContext,
): Promise<void> {
  if (proof !== undefined) {
    const council = await readHeadCouncil(pool, worker.council_id);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken))
      throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    if (worker.owner_id !== null && (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken)) {
      throw new WorkerError("Worker owner proof is stale or fenced");
    }
    if (context !== undefined) {
      const captured = council.snapshot.participants.find(
        (participant) => (participant.departmentId ?? participant.participantId) === worker.department_id,
      );
      if (captured === undefined || captured.headRoleId === undefined || !isAuthorizedHeadCouncilActor(context, captured))
        throw new WorkerError("Worker actor is not bound to the captured Head identity and session");
      const active = await client.query(
        "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3 FOR UPDATE",
        [council.goalId, worker.department_id, captured.sessionRef],
      );
      if (active.rowCount !== 1) throw new WorkerError("Captured Head session is no longer authorized for this worker");
    }
  }
}
