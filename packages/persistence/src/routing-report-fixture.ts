import { randomUUID } from "node:crypto";
import { MODEL_CAPABILITY_AXES, taskDemandContentHash, type ModelCapabilityVector, type ModelMapEntry, type RoutingEvidence, type TaskDemand, type WorkCharacter } from "@maestro/domain";
import type { Pool } from "pg";
import { recordRoutingEvidence } from "./ensemble-router-artifacts.js";

/**
 * Supplies the legacy end-to-end Goal scenarios with the same durable routing
 * inputs required by the Phase 3 final-report gate. These scenarios use the
 * fake kernel, so the binding is an identity-only fixture rather than a live
 * provider admission.
 */
export async function recordRoutingReportFixture(pool: Pool, goalId: string, projectId: string): Promise<RoutingEvidence> {
  const bindingId = randomUUID();
  const executionRef = `report-execution-${bindingId}`;
  const invocationRef = `report-invocation-${bindingId}`;
  await pool.query(
    `INSERT INTO native_execution_bindings
      (binding_id, execution_ref, invocation_ref, goal_id, project_id, admission_kind,
       operator_id, mission_bundle_id, policy_version, idempotency_key,
       selected_model_provider, selected_model_id, actual_model_provider, actual_model_id,
       account_ref)
     VALUES ($1, $2, $3, $4, $5, 'conversation', $6, $7, '1', $8, 'provider', 'model', 'provider', 'model', 'account-1')`,
    [bindingId, executionRef, invocationRef, goalId, projectId, "fixture-operator", `fixture-mission-${bindingId}`, `fixture-idempotency-${bindingId}`],
  );

  const taskDemand: TaskDemand = {
    schemaVersion: 1,
    taskKinds: ["coding"],
    requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])) as TaskDemand["requirements"],
    provenance: { taskContractRef: "fixture-contract", headDecisionRef: "fixture-decision" },
  };
  const workCharacter: WorkCharacter = {
    schemaVersion: 1,
    risk: 40,
    reversibility: 120,
    verificationAttachment: 80,
    materialScale: 20,
    timePressure: 30,
    budgetHeadroom: 150,
    provenance: { taskContractRef: "fixture-contract", headDecisionRef: "fixture-decision" },
  };
  const createdAt = new Date().toISOString();
  const evidence: RoutingEvidence = {
    schemaVersion: 1,
    evidenceId: `routing-evidence-${bindingId}`,
    goalRef: goalId,
    projectRef: projectId,
    routeRef: `routing-route-${bindingId}`,
    mode: "ensemble",
    selectedModelRef: "provider/model",
    accountBinding: "account-1",
    candidateRefs: ["candidate-1"],
    selectedCandidateRef: "candidate-1",
    rejections: [],
    taskDemandHash: taskDemandContentHash(taskDemand),
    pressure: 100,
    pressureBand: "high",
    decisionLayer: "Encore Council",
    overlayVersion: 1,
    admissionBindingRef: bindingId,
    rationale: "selected after hard filters",
    createdAt,
    pressureCalculation: { pressureFloor: 200 / 3, pressure: 100, explicitHeadUplift: 100 },
    taskKindRecipeVersions: { coding: 1 },
    taskDemand,
    workCharacter,
    modelProfile: {
      modelRef: "provider/model",
      capability: { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 180, rationale: "fixture review", evidence: ["fixture-review"] }])) as unknown as ModelCapabilityVector["axes"] },
      providerFacts: {
        schemaVersion: 1,
        contextCapacity: 128000,
        pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        authentication: { modes: ["api-key"] },
        dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] },
        modalities: ["text"],
        toolCalls: { supported: true },
        provenance: { source: "fixture", observedAt: "2026-09-10" },
      },
      provenance: { owner: "human", sourceRefs: ["fixture-review"], reviewedAt: "2026-09-10" },
    } as ModelMapEntry,
    operationalOverlaySnapshot: {
      schemaVersion: 1,
      installationRef: "fixture-installation",
      projectRef: projectId,
      goalRef: goalId,
      overlayVersion: 1,
      observations: [{ candidateRef: "candidate-1", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: createdAt }],
    },
    approvalRef: null,
    approvalIdentity: null,
  };
  await recordRoutingEvidence(pool, evidence);
  return evidence;
}
