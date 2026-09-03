import { randomUUID } from "node:crypto";
import {
  assessFireflySilence,
  computeFireflyImprovementEvidence,
  requiresImmediateSafePause,
  scoreFireflySignals,
  type FireflySeverity,
  type FireflySilenceAssessment,
  type FireflySilencePolicy,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { requestPauseGoalInTransaction } from "./authority.js";
import { assertGoalControlOpen, type CouncilActorContext } from "./council.js";
import type { StoredFireflySignal } from "./firefly.js";

export class FireflyIncidentError extends Error {}
export class FireflyIncidentNotFoundError extends FireflyIncidentError {}
export class FireflyIncidentAuthorizationError extends FireflyIncidentError {}

export type FireflyIncidentStatus = "open" | "triaging" | "remediating" | "resolved" | "false_positive";

export interface FireflyIncidentRecord {
  readonly incidentId: string;
  readonly incidentFingerprint: string;
  readonly affectedVersion: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly severity: FireflySeverity;
  readonly confidence: number;
  readonly affectedComponent: string;
  readonly status: FireflyIncidentStatus;
  readonly signalCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly linkedGoalId: string | null;
  readonly resolutionSummary: string | null;
  readonly retainedRisk: string | null;
  readonly closedAt: string | null;
}

const INCIDENT_COLUMNS = "incident_id, incident_fingerprint, affected_version, first_observed_at, last_observed_at, severity, confidence, affected_component, status, signal_count, created_at, updated_at, linked_goal_id, resolution_summary, retained_risk, closed_at";

interface IncidentRow {
  incident_id: string;
  incident_fingerprint: string;
  affected_version: string;
  first_observed_at: Date;
  last_observed_at: Date;
  severity: FireflySeverity;
  confidence: number;
  affected_component: string;
  status: FireflyIncidentStatus;
  signal_count: number;
  created_at: Date;
  updated_at: Date;
  linked_goal_id: string | null;
  resolution_summary: string | null;
  retained_risk: string | null;
  closed_at: Date | null;
}

interface IncidentSignalRow {
  signal_id: string;
  incident_fingerprint: string;
  affected_version: string;
  first_observed_at: Date;
  last_observed_at: Date;
  severity: FireflySeverity;
  confidence: number;
  affected_component: string;
}

function mapIncident(row: IncidentRow): FireflyIncidentRecord {
  return {
    incidentId: row.incident_id,
    incidentFingerprint: row.incident_fingerprint,
    affectedVersion: row.affected_version,
    firstObservedAt: row.first_observed_at.toISOString(),
    lastObservedAt: row.last_observed_at.toISOString(),
    severity: row.severity,
    confidence: Number(row.confidence),
    affectedComponent: row.affected_component,
    status: row.status,
    signalCount: Number(row.signal_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    linkedGoalId: row.linked_goal_id,
    resolutionSummary: row.resolution_summary,
    retainedRisk: row.retained_risk,
    closedAt: row.closed_at?.toISOString() ?? null,
  };
}

/**
 * Attach one already-authenticated durable signal to exactly one incident
 * identity, using the caller's open transaction. Recording a new signal
 * calls this in the same transaction as its insert so a failure here rolls
 * back the signal too; nothing durable is ever an unattached orphan.
 */
export async function attachSignalToIncidentInTransaction(client: PoolClient, signalId: string): Promise<FireflyIncidentRecord> {
  if (signalId.trim() === "") throw new FireflyIncidentError("signalId is required");
  const signal = await client.query<IncidentSignalRow>(
    `SELECT signal_id, incident_fingerprint, affected_version, first_observed_at,
            last_observed_at, severity, confidence, affected_component
       FROM firefly_signals WHERE signal_id = $1 FOR SHARE`,
    [signalId.trim()],
  );
  if (signal.rowCount !== 1) throw new FireflyIncidentNotFoundError(`Firefly signal not found: ${signalId}`);
  const observation = signal.rows[0]!;
  await client.query(
    `INSERT INTO firefly_incidents
       (incident_id, incident_fingerprint, affected_version, first_observed_at,
        last_observed_at, severity, confidence, affected_component, signal_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
     ON CONFLICT (incident_fingerprint, affected_version) DO NOTHING`,
    [randomUUID(), observation.incident_fingerprint, observation.affected_version,
      observation.first_observed_at, observation.last_observed_at, observation.severity,
      observation.confidence, observation.affected_component],
  );
  const incidentResult = await client.query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS}
       FROM firefly_incidents
      WHERE incident_fingerprint = $1 AND affected_version = $2
      FOR UPDATE`,
    [observation.incident_fingerprint, observation.affected_version],
  );
  if (incidentResult.rowCount !== 1) throw new FireflyIncidentError("Firefly incident identity was not created");
  const incident = incidentResult.rows[0]!;
  const link = await client.query(
    `INSERT INTO firefly_incident_signals (incident_id, signal_id)
     VALUES ($1, $2) ON CONFLICT (signal_id) DO NOTHING RETURNING signal_id`,
    [incident.incident_id, observation.signal_id],
  );
  let current = incident;
  if (link.rowCount === 1) {
    const score = scoreFireflySignals([
      { severity: incident.severity, confidence: Number(incident.confidence) },
      { severity: observation.severity, confidence: Number(observation.confidence) },
    ]);
    const updated = await client.query<IncidentRow>(
      `UPDATE firefly_incidents
          SET first_observed_at = LEAST(first_observed_at, $2::timestamptz),
              last_observed_at = GREATEST(last_observed_at, $3::timestamptz),
              severity = $4, confidence = $5, signal_count = signal_count + 1,
              updated_at = transaction_timestamp()
        WHERE incident_id = $1
      RETURNING ${INCIDENT_COLUMNS}`,
      [incident.incident_id, observation.first_observed_at, observation.last_observed_at, score.severity, score.confidence],
    );
    current = updated.rows[0]!;
  }
  return mapIncident(current);
}

/** Idempotent standalone recovery path: attach or re-attach an already-durable
 * signal outside the original insert transaction (e.g. backfilling an
 * orphan left by a pre-atomic-attach code path). Ordinary ingestion uses
 * {@link attachSignalToIncidentInTransaction} directly instead. */
export async function attachFireflySignalToIncident(pool: Pool, signalId: string): Promise<FireflyIncidentRecord> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await attachSignalToIncidentInTransaction(client, signalId);
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

export async function listFireflyIncidents(pool: Pool, fingerprint?: string): Promise<readonly FireflyIncidentRecord[]> {
  const result = await pool.query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS}
       FROM firefly_incidents
      WHERE ($1::text IS NULL OR incident_fingerprint = $1)
      ORDER BY first_observed_at, incident_id`,
    [fingerprint ?? null],
  );
  return result.rows.map(mapIncident);
}

export interface FireflySilenceCheckRecord extends FireflySilenceAssessment {
  readonly checkId: string;
  readonly checkedAt: string;
  readonly lastObservedAt: string | null;
  readonly maxSilenceMs: number;
}

interface SilenceRow {
  check_id: string;
  checked_at: Date;
  last_observed_at: Date | null;
  max_silence_ms: string;
  silence_ms: string | null;
  state: FireflySilenceAssessment["state"];
  reason: FireflySilenceAssessment["reason"];
}

function mapSilence(row: SilenceRow): FireflySilenceCheckRecord {
  return {
    checkId: row.check_id,
    checkedAt: row.checked_at.toISOString(),
    lastObservedAt: row.last_observed_at?.toISOString() ?? null,
    maxSilenceMs: Number(row.max_silence_ms),
    state: row.state,
    silenceMs: row.silence_ms === null ? null : Number(row.silence_ms),
    reason: row.reason,
  };
}

/**
 * The caller-supplied `lastObservedAt` is only a fallback for the case where
 * Firefly has never durably recorded any signal at all. Whenever a durable
 * signal exists, its real `MAX(last_observed_at)` is used instead, so a
 * stale or buggy caller can never claim "recently observed" (or "long
 * silent") when the durable record disagrees.
 */
export async function recordFireflySilenceCheck(
  pool: Pool,
  lastObservedAt: string | null,
  checkedAt: string,
  policy: FireflySilencePolicy,
): Promise<FireflySilenceCheckRecord> {
  const durable = await pool.query<{ last_observed_at: Date | null }>("SELECT max(last_observed_at) AS last_observed_at FROM firefly_signals");
  const durableLastObservedAt = durable.rows[0]?.last_observed_at ?? null;
  const derivedLastObservedAt = durableLastObservedAt !== null ? durableLastObservedAt.toISOString() : lastObservedAt;
  const assessment = assessFireflySilence(derivedLastObservedAt, checkedAt, policy);
  const result = await pool.query<SilenceRow>(
    `INSERT INTO firefly_watchdog_checks
       (check_id, checked_at, last_observed_at, max_silence_ms, silence_ms, state, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING check_id, checked_at, last_observed_at, max_silence_ms,
               silence_ms, state, reason`,
    [randomUUID(), checkedAt, derivedLastObservedAt, String(policy.maxSilenceMs), assessment.silenceMs === null ? null : String(assessment.silenceMs), assessment.state, assessment.reason],
  );
  return mapSilence(result.rows[0]!);
}

export async function listFireflySilenceChecks(pool: Pool): Promise<readonly FireflySilenceCheckRecord[]> {
  const result = await pool.query<SilenceRow>(
    `SELECT check_id, checked_at, last_observed_at, max_silence_ms,
            silence_ms, state, reason
       FROM firefly_watchdog_checks ORDER BY checked_at, check_id`,
  );
  return result.rows.map(mapSilence);
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query(
    "SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE",
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 31))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/**
 * Bind one Firefly incident to exactly one remediation Goal, so Sane,
 * Sentinel, and every awakened Head share the same incident identity and
 * duplicate signals never create duplicate Goals. Linking is permitted only
 * while the incident is open or triaging, requires the current lease on the
 * target Goal, and moves the incident into triaging on first link. Retrying
 * the same (incidentId, goalId) pair is idempotent; linking a second,
 * different Goal is rejected.
 */
export async function linkFireflyIncidentToGoal(
  pool: Pool,
  incidentId: string,
  goalId: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<FireflyIncidentRecord> {
  if (incidentId.trim() === "") throw new FireflyIncidentError("incidentId is required");
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) {
    throw new StaleGoalLeaseError(proof.goalId);
  }
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await lockGoalLease(client, proof);
    const current = await client.query<IncidentRow>(`SELECT ${INCIDENT_COLUMNS} FROM firefly_incidents WHERE incident_id = $1 FOR UPDATE`, [incidentId]);
    if (current.rowCount !== 1) throw new FireflyIncidentNotFoundError(`Firefly incident not found: ${incidentId}`);
    const incident = current.rows[0]!;
    if (incident.linked_goal_id === goalId) {
      await client.query("COMMIT");
      open = false;
      return mapIncident(incident);
    }
    if (incident.linked_goal_id !== null) {
      throw new FireflyIncidentError(`Firefly incident ${incidentId} is already linked to a different Goal`);
    }
    if (incident.status !== "open" && incident.status !== "triaging") {
      throw new FireflyIncidentError(`Firefly incident ${incidentId} cannot be linked from status ${incident.status}`);
    }
    const updated = await client.query<IncidentRow>(
      `UPDATE firefly_incidents SET linked_goal_id = $2, linked_at = transaction_timestamp(), status = 'triaging', updated_at = transaction_timestamp()
        WHERE incident_id = $1 RETURNING ${INCIDENT_COLUMNS}`,
      [incidentId, goalId],
    );
    await client.query("COMMIT");
    open = false;
    return mapIncident(updated.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close an incident with its final resolution: `resolved` (remediation
 * completed and independently certified) or `false_positive` (no real
 * incident existed). Closure is final and durable, matching
 * plan/phase4.md's "Close with resolution, retained risk, false-positive
 * result, and Firefly feedback." A false positive may close directly from
 * `open` (for example a vulnerability feed naming an unaffected version);
 * a `resolved` close requires a linked Goal.
 */
export async function closeFireflyIncident(
  pool: Pool,
  incidentId: string,
  outcome: "resolved" | "false_positive",
  resolutionSummary: string,
  retainedRisk: string,
  context: CouncilActorContext,
  proof?: GoalLeaseProof,
): Promise<FireflyIncidentRecord> {
  if (incidentId.trim() === "") throw new FireflyIncidentError("incidentId is required");
  if (resolutionSummary.trim() === "") throw new FireflyIncidentError("resolutionSummary is required");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const current = await client.query<IncidentRow>(`SELECT ${INCIDENT_COLUMNS} FROM firefly_incidents WHERE incident_id = $1 FOR UPDATE`, [incidentId]);
    if (current.rowCount !== 1) throw new FireflyIncidentNotFoundError(`Firefly incident not found: ${incidentId}`);
    const incident = current.rows[0]!;
    if (incident.status === "resolved" || incident.status === "false_positive") {
      await client.query("COMMIT");
      open = false;
      return mapIncident(incident);
    }
    if (outcome === "resolved" && incident.linked_goal_id === null) {
      throw new FireflyIncidentError("A resolved incident requires a linked remediation Goal");
    }
    // Closing an incident linked to a Goal requires proof of the Goal's
    // current lease, so an arbitrary caller cannot mark someone else's
    // remediation Goal resolved. Unlike an ordinary in-flight Goal write,
    // closure legitimately happens after the Goal has already progressed
    // past `active` (for example `certifying`), so this checks lease
    // ownership only, not the stricter active-only control latch.
    if (incident.linked_goal_id !== null) {
      if (proof === undefined || incident.linked_goal_id !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) {
        throw new StaleGoalLeaseError(proof?.goalId ?? incident.linked_goal_id);
      }
      const lease = await client.query(
        "SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE",
        [proof.goalId, proof.ownerId, proof.fencingToken],
      );
      if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
    }
    const updated = await client.query<IncidentRow>(
      `UPDATE firefly_incidents
          SET status = $2, resolution_summary = $3, retained_risk = $4, closed_at = transaction_timestamp(), updated_at = transaction_timestamp()
        WHERE incident_id = $1 RETURNING ${INCIDENT_COLUMNS}`,
      [incidentId, outcome, resolutionSummary.trim(), retainedRisk.trim()],
    );
    const closed = updated.rows[0]!;
    // Every closure durably records improvement evidence in the same
    // transaction. This is read-only evidence for a later Overwatch
    // Improvement Digest; it never triggers a change by itself.
    const linkedAtRow = await client.query<{ linked_at: Date | null }>(
      "SELECT linked_at FROM firefly_incidents WHERE incident_id = $1", [incidentId],
    );
    const evidence = computeFireflyImprovementEvidence(
      outcome,
      closed.severity,
      Number(closed.confidence),
      closed.first_observed_at.toISOString(),
      linkedAtRow.rows[0]!.linked_at?.toISOString() ?? null,
      closed.closed_at!.toISOString(),
    );
    await client.query(
      `INSERT INTO firefly_improvement_evidence
         (evidence_id, incident_id, outcome, severity, confidence, detection_to_triage_ms, triage_to_close_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), incidentId, evidence.outcome, evidence.severity, evidence.confidence, evidence.detectionToTriageMs, evidence.triageToCloseMs],
    );
    await client.query("COMMIT");
    open = false;
    return mapIncident(closed);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A high-confidence critical incident may request an automatic safe pause
 * on its linked Goal before deliberation, through the existing Phase 1
 * authority mechanism -- never a direct patch, deploy, or permission
 * change. Requesting it for a signal that does not meet the threshold is
 * rejected so Firefly cannot pause a Goal outside its documented trigger.
 */
export async function requestFireflyImmediateSafePause(
  pool: Pool,
  incidentId: string,
  projectId: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<FireflyIncidentRecord> {
  if (incidentId.trim() === "") throw new FireflyIncidentError("incidentId is required");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const current = await client.query<IncidentRow>(`SELECT ${INCIDENT_COLUMNS} FROM firefly_incidents WHERE incident_id = $1 FOR UPDATE`, [incidentId]);
    if (current.rowCount !== 1) throw new FireflyIncidentNotFoundError(`Firefly incident not found: ${incidentId}`);
    const incident = current.rows[0]!;
    if (!requiresImmediateSafePause(incident.severity, Number(incident.confidence))) {
      throw new FireflyIncidentAuthorizationError("Firefly incident does not meet the high-confidence critical threshold for an immediate safe pause");
    }
    if (incident.linked_goal_id === null) throw new FireflyIncidentError("Firefly incident has no linked Goal to pause");
    if (incident.linked_goal_id !== proof.goalId || projectId.trim() === "" || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) {
      throw new StaleGoalLeaseError(proof.goalId);
    }
    await requestPauseGoalInTransaction(client, projectId.trim(), incident.linked_goal_id);
    await client.query("COMMIT");
    open = false;
    return mapIncident(incident);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface FireflyImprovementEvidenceRecord {
  readonly evidenceId: string;
  readonly incidentId: string;
  readonly outcome: "resolved" | "false_positive";
  readonly severity: FireflySeverity;
  readonly confidence: number;
  readonly detectionToTriageMs: number | null;
  readonly triageToCloseMs: number | null;
  readonly recordedAt: string;
}

interface ImprovementEvidenceRow {
  evidence_id: string;
  incident_id: string;
  outcome: "resolved" | "false_positive";
  severity: FireflySeverity;
  confidence: number;
  detection_to_triage_ms: string | null;
  triage_to_close_ms: string | null;
  recorded_at: Date;
}

function mapImprovementEvidence(row: ImprovementEvidenceRow): FireflyImprovementEvidenceRecord {
  return {
    evidenceId: row.evidence_id,
    incidentId: row.incident_id,
    outcome: row.outcome,
    severity: row.severity,
    confidence: Number(row.confidence),
    detectionToTriageMs: row.detection_to_triage_ms === null ? null : Number(row.detection_to_triage_ms),
    triageToCloseMs: row.triage_to_close_ms === null ? null : Number(row.triage_to_close_ms),
    recordedAt: row.recorded_at.toISOString(),
  };
}

/** Read-only evidence for a later Overwatch Improvement Digest. Nothing in
 * this module consumes it to trigger a change. */
export async function listFireflyImprovementEvidence(pool: Pick<Pool, "query">): Promise<readonly FireflyImprovementEvidenceRecord[]> {
  const result = await pool.query<ImprovementEvidenceRow>(
    "SELECT evidence_id, incident_id, outcome, severity, confidence, detection_to_triage_ms, triage_to_close_ms, recorded_at FROM firefly_improvement_evidence ORDER BY recorded_at, evidence_id",
  );
  return result.rows.map(mapImprovementEvidence);
}
