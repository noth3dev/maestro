import { randomUUID } from "node:crypto";
import { MODEL_CAPABILITY_AXES, detectDeviceCommandUnknownOutcomeFindings, detectMissingEvidenceFindings, detectMissingPlanItemFindings, detectStaleWorkerFindings, normalizeMetronomeIdentity, type DepartmentPlanItem, type MetronomeFinding } from "@maestro/domain";
import type { Pool } from "pg";
import { assertMetronomeMutationAuthorized, raiseMetronomeChallenge, requireMetronomeAuthorization, type MetronomeActorContext, type MetronomeChallenge } from "./metronome-challenge.js";
import { listCapabilityJournal, listPendingCapabilityEffects, type CapabilityJournalEntry, type PendingCapabilityEffect } from "./capability-approval.js";
import { listRoutingEvidenceForGoal } from "./ensemble-router-artifacts.js";
import type { GoalLeaseProof } from "./commands.js";

export interface MetronomeFindingRecord extends MetronomeFinding {
  readonly findingId: string;
  readonly resolved: boolean;
}

export interface MetronomeApprovalObservation {
  readonly decisions: readonly CapabilityJournalEntry[];
  readonly pendingEffects: readonly PendingCapabilityEffect[];
}

/** Read-only projection of the append-only capability journal and unresolved effects. */
export async function observeCapabilityDecisions(
  pool: Pool,
  capabilityKind: string,
  projectId: string,
  goalId: string,
  limit = 500,
): Promise<MetronomeApprovalObservation> {
  const [decisions, pendingEffects] = await Promise.all([
    listCapabilityJournal(pool, capabilityKind, projectId, goalId, limit),
    listPendingCapabilityEffects(pool, capabilityKind, projectId, goalId),
  ]);
  return {
    decisions: [...decisions].sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime() || left.journalId.localeCompare(right.journalId)),
    pendingEffects,
  };
}

/** Read every capability kind for one Goal without mutating the approval ledger. */
export async function observeGoalCapabilityDecisions(pool: Pool, goalId: string, limit = 500): Promise<MetronomeApprovalObservation> {
  const goal = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [normalizeMetronomeIdentity(goalId)]);
  const projectId = goal.rows[0]?.project_id;
  if (projectId === undefined) throw new Error("Metronome observation Goal was not found");
  const kinds = await pool.query<{ capability_kind: string }>(
    "SELECT DISTINCT capability_kind FROM capability_decision_journal WHERE project_id = $1 AND goal_id = $2 ORDER BY capability_kind",
    [projectId, normalizeMetronomeIdentity(goalId)],
  );
  const observations = await Promise.all(kinds.rows.map((row) => observeCapabilityDecisions(pool, row.capability_kind, projectId, goalId, limit)));
  return {
    decisions: observations.flatMap((observation) => observation.decisions).sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime() || left.journalId.localeCompare(right.journalId)),
    pendingEffects: observations.flatMap((observation) => observation.pendingEffects),
  };
}

interface RoutingCapabilityFact {
  readonly evidenceId?: unknown;
  readonly selectedModelRef?: unknown;
  readonly routeRef?: unknown;
  readonly decisionLayer?: unknown;
  readonly pressureBand?: unknown;
  readonly taskDemand?: { readonly requirements?: Record<string, { readonly level?: unknown }> };
  readonly modelProfile?: { readonly capability?: { readonly axes?: Record<string, { readonly status?: unknown; readonly score?: unknown }> } };
}

export class MetronomeRoutingEvidenceError extends Error {
  constructor(evidenceId: string) { super(`Routing evidence is malformed: ${evidenceId}`); this.name = "MetronomeRoutingEvidenceError"; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function malformedRoutingEvidence(evidenceId: unknown): MetronomeRoutingEvidenceError {
  return new MetronomeRoutingEvidenceError(typeof evidenceId === "string" ? evidenceId : "unknown");
}

/** Derive below-requirement findings from the durable routing payload, failing closed on malformed evidence. */
export function detectBelowRequirementRoutingFindings(
  goalId: string,
  routes: readonly unknown[],
  planVersion: number,
): readonly MetronomeFinding[] {
  const normalizedGoalId = normalizeMetronomeIdentity(goalId);
  const safePlanVersion = Number.isSafeInteger(planVersion) && planVersion > 0 ? planVersion : 1;
  return routes.flatMap((value) => {
    if (!isRecord(value)) throw malformedRoutingEvidence(undefined);
    const route = value as RoutingCapabilityFact;
    const evidenceId = typeof route.evidenceId === "string" && route.evidenceId.trim() !== "" ? route.evidenceId : undefined;
    if (evidenceId === undefined || typeof route.selectedModelRef !== "string" || route.selectedModelRef.trim() === "") throw malformedRoutingEvidence(evidenceId);
    if (!isRecord(route.taskDemand) || !isRecord(route.taskDemand.requirements) || Object.keys(route.taskDemand.requirements).length === 0) throw malformedRoutingEvidence(evidenceId);
    if (!isRecord(route.modelProfile) || !isRecord(route.modelProfile.capability) || !isRecord(route.modelProfile.capability.axes)) throw malformedRoutingEvidence(evidenceId);
    const requirements = route.taskDemand.requirements;
    const axes = route.modelProfile.capability.axes;
    for (const [axis, requirement] of Object.entries(requirements)) {
      if (!MODEL_CAPABILITY_AXES.some((knownAxis) => knownAxis === axis) || !isRecord(requirement) || typeof requirement.level !== "number" || !Number.isFinite(requirement.level)) throw malformedRoutingEvidence(evidenceId);
    }
    const declaredAxes = MODEL_CAPABILITY_AXES.filter((axis) => Object.hasOwn(requirements, axis));
    if (declaredAxes.length === 0) throw malformedRoutingEvidence(evidenceId);
    const belowAxes = declaredAxes.filter((axis) => {
      const requirement = requirements[axis]?.level;
      const score = axes[axis];
      return score?.status !== "scored" || typeof score.score !== "number" || !Number.isFinite(score.score) || score.score < (requirement as number);
    });
    if (belowAxes.length === 0) return [];
    return [{
      goalId: normalizedGoalId,
      ruleId: "below_requirement_routing" as MetronomeFinding["ruleId"],
      evidenceIdentity: evidenceId,
      planVersion: safePlanVersion,
      details: {
        evidenceId,
        selectedModelRef: route.selectedModelRef,
        ...(typeof route.routeRef === "string" ? { routeRef: route.routeRef } : {}),
        ...(typeof route.decisionLayer === "string" ? { decisionLayer: route.decisionLayer } : {}),
        ...(typeof route.pressureBand === "string" ? { pressureBand: route.pressureBand } : {}),
        belowRequirementAxes: belowAxes,
      },
    } satisfies MetronomeFinding];
  });
}

interface FindingRow {
  finding_id: string; goal_id: string; rule_id: MetronomeFinding["ruleId"]; evidence_identity: string;
  plan_version: number; details: Record<string, unknown>; resolved_at: Date | null;
}

function mapFinding(row: FindingRow): MetronomeFindingRecord {
  return {
    findingId: row.finding_id, goalId: row.goal_id, ruleId: row.rule_id, evidenceIdentity: row.evidence_identity,
    planVersion: row.plan_version, details: row.details, resolved: row.resolved_at !== null,
  };
}

/**
 * Scans one Goal's durable state and records any newly detected findings.
 * Deterministic rules only (roadmap/act-1-foundation/phase-03-certification-release.md work-sequence step 1); model
 * judgment for semantic ambiguity is a later step. Idempotent: re-scanning
 * an unchanged Goal records nothing new (unique identity per rule/evidence/
 * plan-version), matching the required "deduplicate by Goal, rule, evidence
 * identity, and active plan version".
 */
export async function scanGoalForMetronomeFindings(
  pool: Pool,
  goalId: string,
  proof: GoalLeaseProof,
  context: MetronomeActorContext,
): Promise<readonly MetronomeFindingRecord[]> {
  const normalizedGoalId = normalizeMetronomeIdentity(goalId);
  const authorization = requireMetronomeAuthorization(proof, context);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await assertMetronomeMutationAuthorized(client, normalizedGoalId, authorization.proof, authorization.context, "metronome");

    const plans = await client.query<{ department_id: string; current_version: number; substance: { items: readonly DepartmentPlanItem[] } }>(
      "SELECT department_id, current_version, substance FROM department_plans WHERE goal_id = $1",
      [normalizedGoalId],
    );
    const currentPlanVersionByDepartment = new Map(plans.rows.map((row) => [row.department_id, row.current_version] as const));
    const currentPlanItemsByDepartment = new Map(plans.rows.map((row) => [
      row.department_id,
      { version: row.current_version, itemIds: new Set(row.substance.items.map((item) => item.itemId)) },
    ] as const));

    const workers = await client.query<{ worker_id: string; department_id: string; plan_version: number; item_id: string }>(
      `SELECT w.worker_id, w.department_id, w.plan_version, w.item_id
         FROM workers w
         JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        WHERE dp.goal_id = $1`,
      [normalizedGoalId],
    );
    const workerFacts = workers.rows.map((row) => ({ workerId: row.worker_id, departmentId: row.department_id, planVersion: row.plan_version, itemId: row.item_id }));

    const project = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [normalizedGoalId]);
    const projectId = project.rows[0]?.project_id;
    const durableEvidence = projectId === undefined
      ? new Set<string>()
      : new Set((await client.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [normalizedGoalId, projectId])).rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));

    const referencedEvidence = await client.query<{ evidence_references: string[] }>(
      `SELECT ic.evidence_references
         FROM integration_commits ic
         JOIN workers w ON w.worker_id = ic.worker_id
         JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        WHERE dp.goal_id = $1`,
      [normalizedGoalId],
    );
    const allReferences = referencedEvidence.rows.flatMap((row) => row.evidence_references);
    const currentMaxPlanVersion = Math.max(0, ...[...currentPlanVersionByDepartment.values()]);

    const unresolvedDeviceCommands = (await client.query<{ command_id: string; device_id: string; grant_id: string }>(
      "SELECT command_id, device_id, grant_id FROM device_command_claims WHERE goal_id = $1 AND state = 'unknown'",
      [normalizedGoalId],
    )).rows.map((row) => ({ commandId: row.command_id, deviceId: row.device_id, grantId: row.grant_id }));
    let routingFacts;
    try { routingFacts = await listRoutingEvidenceForGoal(client, normalizedGoalId); }
    catch { throw new MetronomeRoutingEvidenceError("goal-scoped routing evidence"); }
    if (routingFacts.some((evidence) => evidence.projectRef !== projectId)) throw new MetronomeRoutingEvidenceError("routing evidence project scope");
    const belowRequirementFindings = detectBelowRequirementRoutingFindings(normalizedGoalId, routingFacts, Math.max(1, currentMaxPlanVersion));

    const findings = [
      ...detectStaleWorkerFindings(normalizedGoalId, currentPlanVersionByDepartment, workerFacts),
      ...detectMissingPlanItemFindings(normalizedGoalId, currentPlanItemsByDepartment, workerFacts),
      ...detectMissingEvidenceFindings(normalizedGoalId, currentMaxPlanVersion, allReferences, durableEvidence),
      ...detectDeviceCommandUnknownOutcomeFindings(normalizedGoalId, 0, unresolvedDeviceCommands),
      ...belowRequirementFindings,
    ];

    const recorded: MetronomeFindingRecord[] = [];
    for (const finding of findings) {
      const inserted = await client.query<FindingRow>(
        `INSERT INTO metronome_findings (finding_id, goal_id, rule_id, evidence_identity, plan_version, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (goal_id, rule_id, evidence_identity, plan_version) DO NOTHING
         RETURNING finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at`,
        [randomUUID(), finding.goalId, finding.ruleId, finding.evidenceIdentity, finding.planVersion, JSON.stringify(finding.details)],
      );
      if (inserted.rowCount === 1) recorded.push(mapFinding(inserted.rows[0]!));
    }
    await client.query("COMMIT");
    open = false;
    return recorded;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listMetronomeFindings(pool: Pool, goalId: string, includeResolved = false): Promise<readonly MetronomeFindingRecord[]> {
  const result = await pool.query<FindingRow>(
    includeResolved
      ? "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE goal_id = $1 ORDER BY detected_at"
      : "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE goal_id = $1 AND resolved_at IS NULL ORDER BY detected_at",
    [goalId],
  );
  return result.rows.map(mapFinding);
}

export class MetronomeFindingNotFoundError extends Error {}
export class MetronomeFindingError extends Error {}

/** Resolving a finding is a one-way, auditable action; it requires a nonblank reason, a current Goal lease, and an authorized resolver identity/session. */
export async function resolveMetronomeFinding(
  pool: Pool,
  findingId: string,
  reason: string,
  proof: GoalLeaseProof,
  context: MetronomeActorContext,
): Promise<MetronomeFindingRecord> {
  if (reason.trim() === "") throw new MetronomeFindingError("A Metronome finding resolution requires a nonblank reason");
  const authorization = requireMetronomeAuthorization(proof, context);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const candidate = await client.query<FindingRow>(
      "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE finding_id = $1",
      [findingId.trim()],
    );
    if (candidate.rowCount !== 1) throw new MetronomeFindingNotFoundError(`Metronome finding not found: ${findingId}`);
    await assertMetronomeMutationAuthorized(client, candidate.rows[0]!.goal_id, authorization.proof, authorization.context, "resolver");
    const current = await client.query<FindingRow>(
      "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE finding_id = $1 FOR UPDATE",
      [findingId.trim()],
    );
    if (current.rowCount !== 1) throw new MetronomeFindingNotFoundError(`Metronome finding not found: ${findingId}`);
    const finding = current.rows[0]!;
    if (finding.resolved_at !== null) {
      await client.query("COMMIT"); open = false;
      return mapFinding(finding);
    }
    const updated = await client.query<FindingRow>(
      "UPDATE metronome_findings SET resolved_at = transaction_timestamp(), resolution_reason = $2 WHERE finding_id = $1 RETURNING finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at",
      [findingId.trim(), reason.trim()],
    );
    await client.query("COMMIT"); open = false;
    return mapFinding(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}


/** Raise one idempotent challenge for all currently recorded below-requirement routes. */
export async function challengeBelowRequirementRouting(
  pool: Pool,
  goalId: string,
  proof: GoalLeaseProof,
  context: MetronomeActorContext,
): Promise<readonly MetronomeChallenge[]> {
  const findings = (await listMetronomeFindings(pool, goalId)).filter((finding) => String(finding.ruleId) === "below_requirement_routing");
  if (findings.length === 0) return [];
  const evidenceIds = findings.map((finding) => finding.evidenceIdentity).sort();
  const challenge = await raiseMetronomeChallenge(
    pool,
    normalizeMetronomeIdentity(goalId),
    findings.map((finding) => finding.findingId),
    {
      reason: `Routing selected a model below the declared requirement: ${evidenceIds.join(", ")}`,
      evidenceReferences: evidenceIds,
    },
    proof,
    context,
  );
  return [challenge];
}

export interface MetronomeGoalObservation {
  readonly findings: readonly MetronomeFindingRecord[];
  readonly approvalObservation: MetronomeApprovalObservation;
  readonly challenges: readonly MetronomeChallenge[];
}

/** Run one complete read/observe/challenge pass for a Goal. */
export async function observeGoalForMetronome(
  pool: Pool,
  goalId: string,
  proof: GoalLeaseProof,
  context: MetronomeActorContext,
): Promise<MetronomeGoalObservation> {
  const findings = await scanGoalForMetronomeFindings(pool, goalId, proof, context);
  const approvalObservation = await observeGoalCapabilityDecisions(pool, goalId);
  const challenges = await challengeBelowRequirementRouting(pool, goalId, proof, context);
  return { findings, approvalObservation, challenges };
}

export const observeMetronomeGoal = observeGoalForMetronome;
