import { randomUUID } from "node:crypto";
import {
  assessFireflySilence,
  scoreFireflySignals,
  type FireflySeverity,
  type FireflySilenceAssessment,
  type FireflySilencePolicy,
} from "@maestro/domain";
import type { Pool } from "pg";
import type { StoredFireflySignal } from "./firefly.js";

export class FireflyIncidentError extends Error {}
export class FireflyIncidentNotFoundError extends FireflyIncidentError {}

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
}

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
  };
}

/** Attach one already-authenticated durable signal to exactly one incident identity. */
export async function attachFireflySignalToIncident(pool: Pool, signalId: string): Promise<FireflyIncidentRecord> {
  if (signalId.trim() === "") throw new FireflyIncidentError("signalId is required");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
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
      `SELECT incident_id, incident_fingerprint, affected_version, first_observed_at,
              last_observed_at, severity, confidence, affected_component, status,
              signal_count, created_at, updated_at
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
        RETURNING incident_id, incident_fingerprint, affected_version,
                  first_observed_at, last_observed_at, severity, confidence,
                  affected_component, status, signal_count, created_at, updated_at`,
        [incident.incident_id, observation.first_observed_at, observation.last_observed_at, score.severity, score.confidence],
      );
      current = updated.rows[0]!;
    }
    await client.query("COMMIT");
    open = false;
    return mapIncident(current);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listFireflyIncidents(pool: Pool, fingerprint?: string): Promise<readonly FireflyIncidentRecord[]> {
  const result = await pool.query<IncidentRow>(
    `SELECT incident_id, incident_fingerprint, affected_version, first_observed_at,
            last_observed_at, severity, confidence, affected_component, status,
            signal_count, created_at, updated_at
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

export async function recordFireflySilenceCheck(
  pool: Pool,
  lastObservedAt: string | null,
  checkedAt: string,
  policy: FireflySilencePolicy,
): Promise<FireflySilenceCheckRecord> {
  const assessment = assessFireflySilence(lastObservedAt, checkedAt, policy);
  const result = await pool.query<SilenceRow>(
    `INSERT INTO firefly_watchdog_checks
       (check_id, checked_at, last_observed_at, max_silence_ms, silence_ms, state, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING check_id, checked_at, last_observed_at, max_silence_ms,
               silence_ms, state, reason`,
    [randomUUID(), checkedAt, lastObservedAt, String(policy.maxSilenceMs), assessment.silenceMs === null ? null : String(assessment.silenceMs), assessment.state, assessment.reason],
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
