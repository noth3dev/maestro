import { createHash } from "node:crypto";
import {
  assertValidOperationalOverlay,
  assertValidRoutingEvidence,
  canonicalJson,
  snapshotOperationalOverlayForGoal,
  type OperationalOverlay,
  type OperationalOverlaySnapshot,
  type RoutingEvidence,
} from "@maestro/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export class EnsembleRouterArtifactError extends Error {}
export class EnsembleRouterArtifactConflictError extends EnsembleRouterArtifactError {}
export class EnsembleRouterArtifactIntegrityError extends EnsembleRouterArtifactError {}
export class EnsembleRouterArtifactNotFoundError extends EnsembleRouterArtifactError {}

interface OverlayRow extends QueryResultRow {
  installation_ref: string;
  project_ref: string;
  version: number | string;
  overlay: unknown;
  content_hash: string;
}

interface SnapshotRow extends QueryResultRow {
  goal_ref: string;
  installation_ref: string;
  project_ref: string;
  overlay_version: number | string;
  snapshot: unknown;
  content_hash: string;
}

interface EvidenceRow extends QueryResultRow {
  evidence_id: string;
  goal_ref: string;
  project_ref: string;
  route_ref: string;
  mode: "ensemble" | "pin";
  selected_model_ref: string;
  account_binding: string;
  candidate_refs: unknown;
  task_demand_hash: string;
  pressure: number;
  pressure_band: "low" | "medium" | "high" | "critical";
  decision_layer: "automatic progress" | "Department Head" | "Encore Council" | "user";
  overlay_version: number | string | null;
  admission_binding_ref: string;
  rationale: string;
  evidence: unknown;
}

function contentHash(value: unknown): string {
  try {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Ensemble Router artifact cannot be canonically hashed");
  }
}

function assertHash(value: unknown, expected: string, name: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value) || value !== expected) {
    throw new EnsembleRouterArtifactIntegrityError(`${name} content hash does not match its content`);
  }
}

function toPositiveInteger(value: number | string, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new EnsembleRouterArtifactIntegrityError(`${name} is invalid in storage`);
  return parsed;
}

function mapOverlay(row: OverlayRow): OperationalOverlay {
  try {
    assertValidOperationalOverlay(row.overlay);
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Stored operational overlay is invalid");
  }
  const overlay = row.overlay as OperationalOverlay;
  if (
    overlay.installationRef !== row.installation_ref ||
    overlay.projectRef !== row.project_ref ||
    overlay.version !== toPositiveInteger(row.version, "overlay version")
  ) {
    throw new EnsembleRouterArtifactIntegrityError("Stored operational overlay identity does not match its row");
  }
  assertHash(row.content_hash, contentHash(overlay), "Operational overlay");
  return overlay;
}

function mapSnapshot(row: SnapshotRow): OperationalOverlaySnapshot {
  if (!row.snapshot || typeof row.snapshot !== "object" || Array.isArray(row.snapshot)) {
    throw new EnsembleRouterArtifactIntegrityError("Stored Goal overlay snapshot is not an object");
  }
  const value = row.snapshot as Record<string, unknown>;
  const overlayVersion = toPositiveInteger(row.overlay_version, "snapshot overlay version");
  const overlay = {
    schemaVersion: value.schemaVersion,
    installationRef: row.installation_ref,
    projectRef: row.project_ref,
    version: overlayVersion,
    observations: value.observations,
  };
  try {
    assertValidOperationalOverlay(overlay);
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Stored Goal overlay snapshot is invalid");
  }
  const snapshot = value as unknown as OperationalOverlaySnapshot;
  const expected = snapshotOperationalOverlayForGoal(overlay, row.goal_ref);
  if (
    canonicalJson(snapshot) !== canonicalJson(expected) ||
    snapshot.goalRef !== row.goal_ref ||
    snapshot.installationRef !== row.installation_ref ||
    snapshot.projectRef !== row.project_ref ||
    snapshot.overlayVersion !== overlayVersion
  ) {
    throw new EnsembleRouterArtifactIntegrityError("Stored Goal overlay snapshot identity does not match its row");
  }
  assertHash(row.content_hash, contentHash(snapshot), "Goal overlay snapshot");
  return snapshot;
}

function mapEvidence(row: EvidenceRow): RoutingEvidence {
  try {
    assertValidRoutingEvidence(row.evidence);
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Stored routing evidence is invalid");
  }
  const evidence = row.evidence as RoutingEvidence;
  const storedCandidates = row.candidate_refs;
  if (
    canonicalJson(evidence.candidateRefs) !== canonicalJson(storedCandidates) ||
    evidence.evidenceId !== row.evidence_id ||
    evidence.goalRef !== row.goal_ref ||
    evidence.projectRef !== row.project_ref ||
    evidence.routeRef !== row.route_ref ||
    evidence.mode !== row.mode ||
    evidence.selectedModelRef !== row.selected_model_ref ||
    evidence.accountBinding !== row.account_binding ||
    evidence.taskDemandHash !== row.task_demand_hash ||
    evidence.pressure !== row.pressure ||
    evidence.pressureBand !== row.pressure_band ||
    evidence.decisionLayer !== row.decision_layer ||
    evidence.overlayVersion !==
      (row.overlay_version === null ? null : toPositiveInteger(row.overlay_version, "evidence overlay version")) ||
    evidence.admissionBindingRef !== row.admission_binding_ref ||
    evidence.rationale !== row.rationale
  ) {
    throw new EnsembleRouterArtifactIntegrityError("Stored routing evidence identity does not match its row");
  }
  return evidence;
}

async function readOverlayRow(
  queryable: Queryable,
  installationRef: string,
  projectRef: string,
  version: number,
): Promise<OverlayRow | null> {
  const result = await queryable.query<OverlayRow>(
    "SELECT installation_ref, project_ref, version, overlay, content_hash FROM ensemble_router_operational_overlays WHERE installation_ref = $1 AND project_ref = $2 AND version = $3",
    [installationRef, projectRef, version],
  );
  return result.rows[0] ?? null;
}

export async function recordOperationalOverlay(pool: Pool, overlay: OperationalOverlay): Promise<OperationalOverlay> {
  try {
    assertValidOperationalOverlay(overlay);
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Operational overlay is invalid");
  }
  const hash = contentHash(overlay);
  const result = await pool.query<OverlayRow>(
    "INSERT INTO ensemble_router_operational_overlays (installation_ref, project_ref, version, overlay, content_hash) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT DO NOTHING RETURNING installation_ref, project_ref, version, overlay, content_hash",
    [overlay.installationRef, overlay.projectRef, overlay.version, JSON.stringify(overlay), hash],
  );
  if (result.rowCount === 1) return mapOverlay(result.rows[0]!);
  const existing = await readOverlayRow(pool, overlay.installationRef, overlay.projectRef, overlay.version);
  if (!existing) throw new EnsembleRouterArtifactConflictError("Operational overlay insert was not durable");
  if (existing.content_hash !== hash)
    throw new EnsembleRouterArtifactConflictError("Operational overlay version already contains different content");
  return mapOverlay(existing);
}

export async function readLatestOperationalOverlay(
  pool: Queryable,
  installationRef: string,
  projectRef: string,
): Promise<OperationalOverlay | null> {
  const result = await pool.query<OverlayRow>(
    "SELECT installation_ref, project_ref, version, overlay, content_hash FROM ensemble_router_operational_overlays WHERE installation_ref = $1 AND project_ref = $2 ORDER BY version DESC LIMIT 1",
    [installationRef, projectRef],
  );
  return result.rows[0] ? mapOverlay(result.rows[0]) : null;
}

export async function snapshotOperationalOverlayForGoalDurably(
  pool: Pool,
  overlay: OperationalOverlay,
  goalRef: string,
): Promise<OperationalOverlaySnapshot> {
  try {
    assertValidOperationalOverlay(overlay);
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Operational overlay is invalid");
  }
  const snapshot = snapshotOperationalOverlayForGoal(overlay, goalRef);
  const hash = contentHash(snapshot);
  const result = await pool.query<SnapshotRow>(
    "INSERT INTO ensemble_router_goal_overlay_snapshots (goal_ref, installation_ref, project_ref, overlay_version, snapshot, content_hash) VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT DO NOTHING RETURNING goal_ref, installation_ref, project_ref, overlay_version, snapshot, content_hash",
    [snapshot.goalRef, snapshot.installationRef, snapshot.projectRef, snapshot.overlayVersion, JSON.stringify(snapshot), hash],
  );
  if (result.rowCount === 1) return mapSnapshot(result.rows[0]!);
  const existing = await pool.query<SnapshotRow>(
    "SELECT goal_ref, installation_ref, project_ref, overlay_version, snapshot, content_hash FROM ensemble_router_goal_overlay_snapshots WHERE goal_ref = $1",
    [goalRef],
  );
  if (existing.rowCount !== 1) throw new EnsembleRouterArtifactConflictError("Goal overlay snapshot insert was not durable");
  if (existing.rows[0]!.content_hash !== hash)
    throw new EnsembleRouterArtifactConflictError("Goal already has a different operational overlay snapshot");
  return mapSnapshot(existing.rows[0]!);
}

export async function readGoalOperationalOverlaySnapshot(pool: Queryable, goalRef: string): Promise<OperationalOverlaySnapshot | null> {
  const result = await pool.query<SnapshotRow>(
    "SELECT goal_ref, installation_ref, project_ref, overlay_version, snapshot, content_hash FROM ensemble_router_goal_overlay_snapshots WHERE goal_ref = $1",
    [goalRef],
  );
  return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
}

export async function recordRoutingEvidence(pool: Pool, value: RoutingEvidence): Promise<RoutingEvidence> {
  try {
    assertValidRoutingEvidence(value);
  } catch {
    throw new EnsembleRouterArtifactIntegrityError("Routing evidence is invalid");
  }
  const result = await pool.query<EvidenceRow>(
    "INSERT INTO ensemble_router_routing_evidence (evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16::jsonb) ON CONFLICT DO NOTHING RETURNING evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence",
    [
      value.evidenceId,
      value.goalRef,
      value.projectRef,
      value.routeRef,
      value.mode,
      value.selectedModelRef,
      value.accountBinding,
      JSON.stringify(value.candidateRefs),
      value.taskDemandHash,
      value.pressure,
      value.pressureBand,
      value.decisionLayer,
      value.overlayVersion,
      value.admissionBindingRef,
      value.rationale,
      JSON.stringify(value),
    ],
  );
  if (result.rowCount === 1) return mapEvidence(result.rows[0]!);
  const existing = await readRoutingEvidence(pool, value.evidenceId);
  if (!existing) throw new EnsembleRouterArtifactConflictError("Routing evidence insert was not durable");
  if (canonicalJson(existing) !== canonicalJson(value))
    throw new EnsembleRouterArtifactConflictError("Evidence id already contains different routing evidence");
  return existing;
}

export async function readRoutingEvidence(pool: Queryable, evidenceId: string): Promise<RoutingEvidence | null> {
  const result = await pool.query<EvidenceRow>(
    "SELECT evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence FROM ensemble_router_routing_evidence WHERE evidence_id = $1",
    [evidenceId],
  );
  return result.rows[0] ? mapEvidence(result.rows[0]) : null;
}

export async function listRoutingEvidenceForGoal(pool: Queryable, goalRef: string): Promise<readonly RoutingEvidence[]> {
  const result = await pool.query<EvidenceRow>(
    "SELECT evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence FROM ensemble_router_routing_evidence WHERE goal_ref = $1 ORDER BY created_at, evidence_id",
    [goalRef],
  );
  return Object.freeze(result.rows.map(mapEvidence));
}
