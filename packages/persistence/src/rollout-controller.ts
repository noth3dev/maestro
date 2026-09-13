import { randomUUID } from "node:crypto";
import {
  assertBoundedRolloutScope,
  assertImprovementClassEnabled,
  evaluateProtectedMetrics,
  reconcileInterruptedRollout as reconcileInterruptedRolloutState,
  type ImprovementClass,
  type ImprovementCandidateRollbackTarget,
  type RolloutMetricObservation,
  type RolloutProtectedMetric,
  type RolloutScope,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";

export { type RolloutMetricObservation, type RolloutProtectedMetric, type RolloutScope } from "@maestro/domain";

export class RolloutPersistenceError extends Error {
  constructor(message: string) { super(message); this.name = "RolloutPersistenceError"; }
}
export class RolloutNotFoundError extends RolloutPersistenceError {}

export interface RolloutActor {
  readonly operatorId: string;
  readonly actorId: string;
  readonly sessionRef: string;
  readonly operatorRoleId: string;
}
export interface RolloutEnablement {
  readonly projectId: string;
  readonly improvementClass: ImprovementClass;
  readonly operatorId: string;
  readonly operatorRoleId: string;
  readonly sessionRef: string;
  readonly enabled: true;
  readonly createdAt: string;
}
export interface RolloutObservationInput {
  readonly goalId: string;
  readonly observedAt: string;
  /** Optional assertion of the next monotonic Goal ordinal. */
  readonly goalCount?: number;
  readonly metrics: readonly RolloutMetricObservation[];
}
export interface RolloutStartOptions {
  /** Short lease is used by crash-recovery tests; production callers use the default. */
  readonly rolloutLeaseDurationMs?: number;
}
export interface RolloutHistoryEvent {
  readonly eventId: string;
  readonly kind: "started" | "observation" | "automatic_rollback" | "interrupted" | "reconciled";
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}
export interface ImprovementRollout {
  readonly rolloutId: string;
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly projectId: string;
  readonly goalId: string;
  readonly improvementClass: ImprovementClass;
  readonly scope: RolloutScope;
  readonly protectedMetrics: readonly RolloutProtectedMetric[];
  readonly rollbackTarget: ImprovementCandidateRollbackTarget;
  readonly sourceEvidenceIds: readonly string[];
  readonly activeCandidateId: string;
  readonly activeVersion: number;
  readonly lastCertifiedCandidateId: string;
  readonly lastCertifiedVersion: number;
  readonly observedGoalCount: number;
  readonly observedGoalIds: readonly string[];
  readonly status: "active" | "interrupted" | "certified" | "rolled_back";
  readonly history: readonly RolloutHistoryEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

type RolloutRow = {
  rollout_id: string; candidate_id: string; candidate_version: number; project_id: string; goal_id: string;
  improvement_class: ImprovementClass; role_id: string; task_class: string; max_goal_count: number;
  window_start: Date; window_end: Date; protected_metrics: RolloutProtectedMetric[]; rollback_target: ImprovementCandidateRollbackTarget;
  source_evidence_ids: string[]; active_candidate_id: string; active_version: number; last_certified_candidate_id: string;
  last_certified_version: number; observed_goal_count: number; observed_goal_ids: string[];
  owner_operator_id: string; owner_actor_id: string; owner_role_id: string; owner_session_ref: string; owner_lease_duration_ms: number; owner_lease_expires_at: Date;
  status: ImprovementRollout["status"];
  operation_ref: string; created_at: Date; updated_at: Date;
};
type EventRow = { event_id: string; rollout_id: string; kind: RolloutHistoryEvent["kind"]; details: Record<string, unknown>; created_at: Date };
type CandidateRow = { candidate_id: string; version: number; project_id: string; goal_id: string; kind: ImprovementClass; state: string; target: Record<string, string>; rollback_target: ImprovementCandidateRollbackTarget; source_evidence_ids: string[] };
const COLUMNS = `rollout_id, candidate_id, candidate_version, project_id, goal_id, improvement_class, role_id, task_class,
  max_goal_count, window_start, window_end, protected_metrics, rollback_target, source_evidence_ids, active_candidate_id,
  active_version, last_certified_candidate_id, last_certified_version, observed_goal_count, observed_goal_ids,
  owner_operator_id, owner_actor_id, owner_role_id, owner_session_ref, owner_lease_duration_ms, owner_lease_expires_at, status, operation_ref, created_at, updated_at`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256 || /[\r\n]/.test(value)) throw new RolloutPersistenceError(`${field} is invalid`);
  return value.trim();
}
function uuid(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!UUID.test(result)) throw new RolloutPersistenceError(`${field} must be a durable UUID`);
  return result;
}
function operation(prefix: string, key: string): string {
  const result = `${prefix}${text(key, "Rollout idempotency key")}`;
  if (result.length > 256) throw new RolloutPersistenceError("Rollout idempotency key is too long");
  return result;
}
function actorValue(actor: RolloutActor): RolloutActor {
  return { operatorId: uuid(actor?.operatorId, "Rollout operatorId"), actorId: text(actor?.actorId, "Rollout actorId"), sessionRef: text(actor?.sessionRef, "Rollout sessionRef"), operatorRoleId: text(actor?.operatorRoleId, "Rollout operatorRoleId") };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function assertStartReplay(row: RolloutRow, candidateId: string, scope: RolloutScope, actor: RolloutActor): void {
  if (row.candidate_id !== candidateId || row.role_id !== scope.roleId || row.task_class !== scope.taskClass || row.max_goal_count !== scope.maxGoalCount
      || row.window_start.toISOString() !== new Date(scope.windowStart).toISOString() || row.window_end.toISOString() !== new Date(scope.windowEnd).toISOString()
      || row.owner_operator_id !== actor.operatorId || row.owner_actor_id !== actor.actorId || row.owner_role_id !== actor.operatorRoleId || row.owner_session_ref !== actor.sessionRef) {
    throw new RolloutPersistenceError("Rollout idempotency key was reused with different candidate, scope, or actor");
  }
}

function validateProtectedMetrics(metrics: readonly RolloutProtectedMetric[]): void {
  if (!Array.isArray(metrics) || metrics.length === 0 || metrics.length > 16) throw new RolloutPersistenceError("Rollout protected metrics are invalid");
  const names = new Set<string>();
  for (const metric of metrics) {
    if (!metric || typeof metric.name !== "string" || metric.name.trim() === "" || names.has(metric.name)
        || (metric.minimum === undefined && metric.maximum === undefined)
        || (metric.minimum !== undefined && !Number.isFinite(metric.minimum)) || (metric.maximum !== undefined && !Number.isFinite(metric.maximum))
        || (metric.minimum !== undefined && metric.maximum !== undefined && metric.minimum > metric.maximum)) throw new RolloutPersistenceError("Rollout protected metric is invalid");
    names.add(metric.name);
  }
}

function map(row: RolloutRow, events: readonly EventRow[]): ImprovementRollout {
  return {
    rolloutId: row.rollout_id, candidateId: row.candidate_id, candidateVersion: row.candidate_version, projectId: row.project_id,
    goalId: row.goal_id, improvementClass: row.improvement_class,
    scope: { roleId: row.role_id, taskClass: row.task_class, maxGoalCount: row.max_goal_count, windowStart: row.window_start.toISOString(), windowEnd: row.window_end.toISOString() },
    protectedMetrics: row.protected_metrics, rollbackTarget: row.rollback_target, sourceEvidenceIds: row.source_evidence_ids,
    activeCandidateId: row.active_candidate_id, activeVersion: row.active_version, lastCertifiedCandidateId: row.last_certified_candidate_id,
    lastCertifiedVersion: row.last_certified_version, observedGoalCount: row.observed_goal_count, observedGoalIds: row.observed_goal_ids, status: row.status,
    history: events.map((event) => ({ eventId: event.event_id, kind: event.kind, details: event.details, createdAt: event.created_at.toISOString() })),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
async function readRow(client: Pick<Pool | PoolClient, "query">, rolloutId: string, forUpdate = false): Promise<RolloutRow> {
  const id = uuid(rolloutId, "Rollout rolloutId");
  const result = await client.query<RolloutRow>(`SELECT ${COLUMNS} FROM improvement_rollouts WHERE rollout_id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  if (result.rowCount !== 1) throw new RolloutNotFoundError(`Rollout not found: ${id}`);
  return result.rows[0]!;
}
async function events(client: Pick<Pool | PoolClient, "query">, rolloutId: string): Promise<readonly EventRow[]> {
  const result = await client.query<EventRow>("SELECT event_id, rollout_id, kind, details, created_at FROM improvement_rollout_events WHERE rollout_id = $1 ORDER BY created_at, event_id", [rolloutId]);
  return result.rows;
}
async function result(client: Pick<Pool | PoolClient, "query">, row: RolloutRow): Promise<ImprovementRollout> { return map(row, await events(client, row.rollout_id)); }
async function authorizeWrite(client: PoolClient): Promise<void> {
  const token = randomUUID();
  await client.query("SELECT set_config('maestro.improvement_rollout_token', $1, true)", [token]);
  await client.query("INSERT INTO improvement_rollout_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))", [token]);
}
async function operatorAuthorized(client: PoolClient, actor: RolloutActor, projectId: string): Promise<void> {
  const result = await client.query(`SELECT 1 FROM local_operators o JOIN operator_project_memberships m ON m.operator_id = o.operator_id AND m.project_id = $2 AND m.active = true JOIN operator_project_roles r ON r.operator_id = o.operator_id AND r.project_id = $2 AND r.role_id = $3 AND r.active = true WHERE o.operator_id = $1 AND o.active = true`, [actor.operatorId, projectId, actor.operatorRoleId]);
  if (result.rowCount !== 1) throw new RolloutPersistenceError("Rollout actor is not an active project operator with the declared role");
}
async function mutationAuthorized(client: PoolClient, row: RolloutRow, proof: GoalLeaseProof, actor: RolloutActor): Promise<void> {
  if (proof.goalId.toLowerCase() !== row.goal_id) throw new RolloutPersistenceError("Rollout mutation is outside the leased Goal");
  await operatorAuthorized(client, actor, row.project_id);
}
async function ownerMutationAuthorized(client: PoolClient, row: RolloutRow, proof: GoalLeaseProof, actor: RolloutActor): Promise<void> {
  await mutationAuthorized(client, row, proof, actor);
  if (row.owner_operator_id !== actor.operatorId || row.owner_actor_id !== actor.actorId || row.owner_role_id !== actor.operatorRoleId || row.owner_session_ref !== actor.sessionRef) {
    throw new RolloutPersistenceError("Rollout mutation actor is not the durable rollout owner");
  }
  if (row.owner_lease_expires_at.getTime() <= Date.now()) throw new RolloutPersistenceError("Rollout owner lease has expired; startup reconciliation must run");
}

export async function enableImprovementClass(pool: Pool, projectId: string, improvementClass: ImprovementClass, proof: GoalLeaseProof, rawActor: RolloutActor, idempotencyKey: string): Promise<RolloutEnablement> {
  const project = uuid(projectId, "Rollout projectId");
  const actor = actorValue(rawActor);
  assertImprovementClassEnabled(improvementClass, [improvementClass]);
  if (proof.goalId.toLowerCase() === "" || proof.goalId.toLowerCase() === undefined) throw new RolloutPersistenceError("Rollout lease proof is required");
  return withGoalAuthority(pool, proof, 95, async (client) => {
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [proof.goalId.toLowerCase()]);
    if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== project) throw new RolloutPersistenceError("Rollout project is not bound to the leased Goal");
    await operatorAuthorized(client, actor, project);
    const op = operation("rollout:enable:", idempotencyKey);
    const existing = await client.query<RolloutEnablement>("SELECT project_id AS \"projectId\", improvement_class AS \"improvementClass\", operator_id AS \"operatorId\", operator_role_id AS \"operatorRoleId\", session_ref AS \"sessionRef\", enabled, created_at AS \"createdAt\" FROM improvement_class_enablements WHERE project_id = $1 AND improvement_class = $2", [project, improvementClass]);
    if (existing.rowCount === 1) return { ...existing.rows[0]!, createdAt: new Date(existing.rows[0]!.createdAt).toISOString(), enabled: true };
    await authorizeWrite(client);
    const inserted = await client.query<RolloutEnablement>("INSERT INTO improvement_class_enablements (project_id, improvement_class, operator_id, operator_role_id, session_ref, operation_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING project_id AS \"projectId\", improvement_class AS \"improvementClass\", operator_id AS \"operatorId\", operator_role_id AS \"operatorRoleId\", session_ref AS \"sessionRef\", enabled, created_at AS \"createdAt\"", [project, improvementClass, actor.operatorId, actor.operatorRoleId, actor.sessionRef, op]);
    const row = inserted.rows[0]!;
    return { ...row, createdAt: new Date(row.createdAt).toISOString(), enabled: true };
  });
}

export async function startBoundedRollout(pool: Pool, candidateId: string, rawScope: RolloutScope, proof: GoalLeaseProof, rawActor: RolloutActor, idempotencyKey: string, options: RolloutStartOptions = {}): Promise<ImprovementRollout> {
  const id = uuid(candidateId, "Rollout candidateId");
  const scope = assertBoundedRolloutScope(rawScope);
  const actor = actorValue(rawActor);
  const leaseDurationMs = options.rolloutLeaseDurationMs ?? 60_000;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0 || leaseDurationMs > 60 * 60 * 1000) throw new RolloutPersistenceError("Rollout lease duration is invalid");
  const op = operation("rollout:start:", idempotencyKey);
  return withGoalAuthority(pool, proof, 95, async (client) => {
    const existing = await client.query<RolloutRow>(`SELECT ${COLUMNS} FROM improvement_rollouts WHERE operation_ref = $1 FOR UPDATE`, [op]);
    if (existing.rowCount === 1) {
      await ownerMutationAuthorized(client, existing.rows[0]!, proof, actor);
      assertStartReplay(existing.rows[0]!, id, scope, actor);
      return result(client, existing.rows[0]!);
    }
    const candidate = await client.query<CandidateRow>("SELECT candidate_id, version, project_id, goal_id, kind, state, target, rollback_target, source_evidence_ids FROM improvement_candidates WHERE candidate_id = $1 FOR KEY SHARE", [id]);
    if (candidate.rowCount !== 1) throw new RolloutPersistenceError("Rollout candidate does not exist");
    const source = candidate.rows[0]!;
    if (source.goal_id !== proof.goalId.toLowerCase()) throw new RolloutPersistenceError("Rollout candidate is outside the leased Goal");
    await operatorAuthorized(client, actor, source.project_id);
    if (source.state !== "judged") throw new RolloutPersistenceError("Only a judged candidate can start a rollout");
    if (source.target.roleId !== scope.roleId || source.target.taskClass !== scope.taskClass) throw new RolloutPersistenceError("Rollout scope cannot widen beyond the candidate target");
    const candidateDetails = await client.query<{ protected_metrics: RolloutProtectedMetric[] }>("SELECT protected_metrics FROM improvement_candidates WHERE candidate_id = $1", [id]);
    const protectedMetrics = candidateDetails.rows[0]?.protected_metrics;
    validateProtectedMetrics(protectedMetrics ?? []);
    const enabled = await client.query("SELECT 1 FROM improvement_class_enablements WHERE project_id = $1 AND improvement_class = $2 AND enabled = true", [source.project_id, source.kind]);
    assertImprovementClassEnabled(source.kind, enabled.rowCount === 1 ? [source.kind] : []);
    const rolloutId = randomUUID();
    const rollbackTarget = source.rollback_target;
    await authorizeWrite(client);
    const inserted = await client.query<RolloutRow>(`INSERT INTO improvement_rollouts
      (rollout_id, candidate_id, candidate_version, project_id, goal_id, improvement_class, role_id, task_class, max_goal_count, window_start, window_end, protected_metrics, rollback_target, source_evidence_ids, active_candidate_id, active_version, last_certified_candidate_id, last_certified_version, owner_operator_id, owner_actor_id, owner_role_id, owner_session_ref, owner_lease_duration_ms, owner_lease_expires_at, status, operation_ref)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::jsonb, $13::jsonb, $14::jsonb, $2, $3, $15, $16, $17, $18, $19, $20, $21::integer, transaction_timestamp() + ($21::bigint * interval '1 millisecond'), 'active', $22) RETURNING ${COLUMNS}`,
      [rolloutId, source.candidate_id, source.version, source.project_id, source.goal_id, source.kind, scope.roleId, scope.taskClass, scope.maxGoalCount, scope.windowStart, scope.windowEnd, JSON.stringify(protectedMetrics), JSON.stringify(rollbackTarget), JSON.stringify(source.source_evidence_ids), rollbackTarget.candidateId, rollbackTarget.version, actor.operatorId, actor.actorId, actor.operatorRoleId, actor.sessionRef, leaseDurationMs, op]);
    await authorizeWrite(client);
    await client.query("INSERT INTO improvement_rollout_events (event_id, rollout_id, kind, details, operation_ref) VALUES ($1, $2, 'started', $3::jsonb, $4)", [randomUUID(), rolloutId, JSON.stringify({ candidateId: source.candidate_id, candidateVersion: source.version, actorId: actor.actorId, sessionRef: actor.sessionRef }), `${op}:event`]);
    return result(client, inserted.rows[0]!);
  });
}

export async function observeBoundedRollout(pool: Pool, rolloutId: string, input: RolloutObservationInput, proof: GoalLeaseProof, rawActor: RolloutActor, idempotencyKey: string): Promise<ImprovementRollout> {
  const id = uuid(rolloutId, "Rollout rolloutId"); const actor = actorValue(rawActor); const observation = { ...input, goalId: uuid(input.goalId, "Rollout observation goalId") };
  const op = operation("rollout:observe:", idempotencyKey);
  return withGoalAuthority(pool, proof, 95, async (client) => {
    const existingEvent = await client.query<{ rollout_id: string; details: Record<string, unknown> }>("SELECT rollout_id, details FROM improvement_rollout_events WHERE operation_ref = $1", [op]);
    if (existingEvent.rowCount === 1) {
      const prior = existingEvent.rows[0]!;
      const priorGoalCount = prior.details.goalCount;
      const replayRow = await readRow(client, id);
      await ownerMutationAuthorized(client, replayRow, proof, actor);
      if (prior.rollout_id !== id || prior.details.goalId !== observation.goalId || prior.details.observedAt !== observation.observedAt
          || canonical(prior.details.metrics) !== canonical(observation.metrics)
          || (observation.goalCount !== undefined && priorGoalCount !== observation.goalCount)) throw new RolloutPersistenceError("Rollout observation idempotency key was reused with different content");
      return result(client, replayRow);
    }
    const row = await readRow(client, id, true);
    if (row.goal_id !== proof.goalId.toLowerCase() || observation.goalId !== row.goal_id) throw new RolloutPersistenceError("Rollout observation is outside its Goal");
    await ownerMutationAuthorized(client, row, proof, actor);
    if (row.status !== "active") throw new RolloutPersistenceError("Rollout is not active");
    if (row.owner_lease_expires_at.getTime() <= Date.now()) throw new RolloutPersistenceError("Rollout owner lease has expired; startup reconciliation must run");
    const observedAt = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedAt) || observedAt < row.window_start.getTime() || observedAt > row.window_end.getTime()) throw new RolloutPersistenceError("Rollout observation is outside its fixed time window");
    const observedGoalIds = row.observed_goal_ids.map((goalId) => goalId.toLowerCase());
    if (observedGoalIds.includes(observation.goalId)) throw new RolloutPersistenceError("Rollout observation already contains this Goal");
    const goalCount = row.observed_goal_count + 1;
    if (observation.goalCount !== undefined && observation.goalCount !== goalCount) throw new RolloutPersistenceError("Rollout observation Goal count must advance monotonically");
    if (goalCount > row.max_goal_count) throw new RolloutPersistenceError("Rollout observation exceeds its fixed Goal-count bound");
    const nextObservedGoalIds = [...observedGoalIds, observation.goalId];
    const metricDecision = evaluateProtectedMetrics(row.protected_metrics, observation.metrics);
    const rollback = metricDecision.decision === "rollback";
    const status: ImprovementRollout["status"] = rollback ? "rolled_back" : goalCount === row.max_goal_count ? "certified" : "active";
    const activeCandidateId = rollback ? row.rollback_target.candidateId : row.active_candidate_id;
    const activeVersion = rollback ? row.rollback_target.version : row.active_version;
    const lastCertifiedCandidateId = rollback ? row.last_certified_candidate_id : status === "certified" ? row.candidate_id : row.last_certified_candidate_id;
    const lastCertifiedVersion = rollback ? row.last_certified_version : status === "certified" ? row.candidate_version : row.last_certified_version;
    await authorizeWrite(client);
    const updated = await client.query<RolloutRow>(`UPDATE improvement_rollouts SET active_candidate_id = $2, active_version = $3, last_certified_candidate_id = $4, last_certified_version = $5, observed_goal_count = $6, observed_goal_ids = $7::jsonb, status = $8, owner_lease_expires_at = transaction_timestamp() + (owner_lease_duration_ms::bigint * interval '1 millisecond'), updated_at = transaction_timestamp() WHERE rollout_id = $1 AND owner_operator_id = $9 AND owner_lease_expires_at > clock_timestamp() RETURNING ${COLUMNS}`, [id, activeCandidateId, activeVersion, lastCertifiedCandidateId, lastCertifiedVersion, goalCount, JSON.stringify(nextObservedGoalIds), status, actor.operatorId]);
    if (updated.rowCount !== 1) throw new RolloutPersistenceError("Rollout owner lease expired before observation commit");
    await authorizeWrite(client);
    await client.query("INSERT INTO improvement_rollout_events (event_id, rollout_id, kind, details, operation_ref) VALUES ($1, $2, $3, $4::jsonb, $5)", [randomUUID(), id, rollback ? "automatic_rollback" : "observation", JSON.stringify({ goalId: observation.goalId, observedAt: observation.observedAt, goalCount, metrics: observation.metrics, violatedMetrics: metricDecision.violatedMetrics, actorId: actor.actorId, sessionRef: actor.sessionRef }), op]);
    return result(client, updated.rows[0]!);
  });
}

export async function interruptBoundedRollout(pool: Pool, rolloutId: string, proof: GoalLeaseProof, rawActor: RolloutActor, idempotencyKey: string): Promise<ImprovementRollout> {
  return transitionRollout(pool, rolloutId, "interrupted", "interrupted", proof, rawActor, idempotencyKey);
}
async function transitionRollout(pool: Pool, rolloutId: string, status: "interrupted" | "rolled_back", eventKind: "interrupted" | "reconciled", proof: GoalLeaseProof, rawActor: RolloutActor, idempotencyKey: string): Promise<ImprovementRollout> {
  const id = uuid(rolloutId, "Rollout rolloutId"); const actor = actorValue(rawActor); const op = operation(`rollout:${eventKind}:`, idempotencyKey);
  return withGoalAuthority(pool, proof, 95, async (client) => {
    const priorEvent = await client.query<{ rollout_id: string; kind: RolloutHistoryEvent["kind"] }>("SELECT rollout_id, kind FROM improvement_rollout_events WHERE operation_ref = $1", [op]);
    if (priorEvent.rowCount === 1) {
      const replayRow = await readRow(client, id);
      if (eventKind === "interrupted") await ownerMutationAuthorized(client, replayRow, proof, actor);
      else await mutationAuthorized(client, replayRow, proof, actor);
      if (priorEvent.rows[0]!.rollout_id !== id || priorEvent.rows[0]!.kind !== eventKind) throw new RolloutPersistenceError("Rollout lifecycle idempotency key was reused with different content");
      return result(client, replayRow);
    }
    const row = await readRow(client, id, true);
    if (status === "interrupted") await ownerMutationAuthorized(client, row, proof, actor);
    else await mutationAuthorized(client, row, proof, actor);
    if (status === "interrupted" && row.status !== "active") throw new RolloutPersistenceError("Only an active rollout can be interrupted");
    if (status === "rolled_back" && row.status !== "interrupted") throw new RolloutPersistenceError("Only an interrupted rollout can be reconciled");
    const target = status === "rolled_back" ? reconcileInterruptedRolloutState({ status: "interrupted", activeCandidateId: row.active_candidate_id, activeVersion: row.active_version, lastCertifiedCandidateId: row.last_certified_candidate_id, lastCertifiedVersion: row.last_certified_version, rollbackTarget: row.rollback_target }) : undefined;
    await authorizeWrite(client);
    const updated = await client.query<RolloutRow>(`UPDATE improvement_rollouts SET status = $2, active_candidate_id = $3, active_version = $4, updated_at = transaction_timestamp() WHERE rollout_id = $1 RETURNING ${COLUMNS}`, [id, status, target?.activeCandidateId ?? row.active_candidate_id, target?.activeVersion ?? row.active_version]);
    await authorizeWrite(client);
    await client.query("INSERT INTO improvement_rollout_events (event_id, rollout_id, kind, details, operation_ref) VALUES ($1, $2, $3, $4::jsonb, $5)", [randomUUID(), id, eventKind, JSON.stringify({ actorId: actor.actorId, sessionRef: actor.sessionRef, rollbackTarget: row.rollback_target }), op]);
    return result(client, updated.rows[0]!);
  });
}
export async function reconcileInterruptedRollout(pool: Pool, rolloutId: string, proof: GoalLeaseProof, actor: RolloutActor, idempotencyKey: string): Promise<ImprovementRollout> {
  return transitionRollout(pool, rolloutId, "rolled_back", "reconciled", proof, actor, idempotencyKey);
}

/** Startup recovery path: a dead owner is detected by the durable rollout lease, not by a caller-supplied interruption flag. */
export async function reconcileExpiredBoundedRollouts(pool: Pool, proof: GoalLeaseProof, rawActor: RolloutActor): Promise<readonly ImprovementRollout[]> {
  const actor = actorValue(rawActor);
  return withGoalAuthority(pool, proof, 95, async (client) => {
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [proof.goalId.toLowerCase()]);
    if (goal.rowCount !== 1) throw new RolloutPersistenceError("Rollout recovery Goal does not exist");
    await operatorAuthorized(client, actor, goal.rows[0]!.project_id);
    const stale = await client.query<RolloutRow>(`SELECT ${COLUMNS} FROM improvement_rollouts WHERE goal_id = $1 AND status = 'active' AND owner_lease_expires_at <= clock_timestamp() ORDER BY created_at, rollout_id FOR UPDATE`, [proof.goalId.toLowerCase()]);
    const recovered: ImprovementRollout[] = [];
    for (const row of stale.rows) {
      const target = reconcileInterruptedRolloutState({ status: "interrupted", activeCandidateId: row.active_candidate_id, activeVersion: row.active_version, lastCertifiedCandidateId: row.last_certified_candidate_id, lastCertifiedVersion: row.last_certified_version, rollbackTarget: row.rollback_target });
      await authorizeWrite(client);
      const updated = await client.query<RolloutRow>(`UPDATE improvement_rollouts SET status = 'rolled_back', active_candidate_id = $2, active_version = $3, updated_at = transaction_timestamp() WHERE rollout_id = $1 RETURNING ${COLUMNS}`, [row.rollout_id, target.activeCandidateId, target.activeVersion]);
      await authorizeWrite(client);
      await client.query("INSERT INTO improvement_rollout_events (event_id, rollout_id, kind, details, operation_ref) VALUES ($1, $2, 'reconciled', $3::jsonb, $4)", [randomUUID(), row.rollout_id, JSON.stringify({ actorId: actor.actorId, sessionRef: actor.sessionRef, reason: "expired_rollout_owner_lease", rollbackTarget: row.rollback_target }), `rollout:startup-reconcile:${row.rollout_id}`]);
      recovered.push(await result(client, updated.rows[0]!));
    }
    return recovered;
  });
}

export async function readBoundedRollout(pool: Pool, rolloutId: string, authorization: { readonly operatorId: string; readonly proof: GoalLeaseProof }): Promise<ImprovementRollout> {
  const row = await readRow(pool, rolloutId); const operator = uuid(authorization.operatorId, "Rollout read operatorId");
  if (authorization.proof.goalId.toLowerCase() !== row.goal_id) throw new RolloutPersistenceError("Rollout read lease Goal is invalid");
  const allowed = await pool.query("SELECT 1 FROM local_operators o JOIN operator_project_memberships m ON m.operator_id = o.operator_id AND m.project_id = $2 AND m.active = true JOIN goal_leases l ON l.goal_id = $3 AND l.owner_id = $4 AND l.fencing_token = $5::bigint AND l.expires_at > clock_timestamp() WHERE o.operator_id = $1 AND o.active = true", [operator, row.project_id, row.goal_id, authorization.proof.ownerId, authorization.proof.fencingToken]);
  if (allowed.rowCount !== 1) throw new RolloutPersistenceError("Rollout read is not authorized");
  return result(pool, row);
}
