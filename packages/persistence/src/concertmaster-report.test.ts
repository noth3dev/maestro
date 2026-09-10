import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, type RoutingEvidence } from "@maestro/domain";
import { evaluateRoutingEvidenceLineage, type RoutingEvidenceCertificationRow } from "./concertmaster-report.js";

const route = (overrides: Partial<RoutingEvidence> = {}): RoutingEvidence => ({
  schemaVersion: 1, evidenceId: "evidence-1", goalRef: "goal-1", projectRef: "project-1", routeRef: "route-1", mode: "pin",
  selectedModelRef: "provider/model", accountBinding: "account-1", candidateRefs: ["candidate-1"], rejections: [],
  taskDemandHash: "a".repeat(64), pressure: 100, pressureBand: "high", decisionLayer: "Encore Council", overlayVersion: 1,
  admissionBindingRef: "binding-1", rationale: "recorded route", createdAt: "2026-09-08T12:00:00Z", approvalRef: null,
  taskKindRecipeVersions: { coding: 1 },
  taskDemand: { schemaVersion: 1, taskKinds: ["coding"], requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])), provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
  workCharacter: { schemaVersion: 1, risk: 40, reversibility: 120, verificationAttachment: 80, materialScale: 20, timePressure: 30, budgetHeadroom: 150, provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
  modelProfile: { modelRef: "provider/model", capability: { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 180, rationale: "review", evidence: ["review-1"] }])) }, providerFacts: { schemaVersion: 1, contextCapacity: 128000, pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "docs", observedAt: "2026-09-08" } }, provenance: { owner: "human", sourceRefs: ["review-1"], reviewedAt: "2026-09-08" } },
  operationalOverlaySnapshot: { schemaVersion: 1, installationRef: "installation-1", projectRef: "project-1", goalRef: "goal-1", overlayVersion: 1, observations: [{ candidateRef: "candidate-1", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-08T12:00:00Z" }] },
  ...overrides,
});
const row = (value: RoutingEvidence, overrides: Partial<RoutingEvidenceCertificationRow> = {}): RoutingEvidenceCertificationRow => ({
  evidence_id: value.evidenceId, goal_ref: value.goalRef, project_ref: value.projectRef, route_ref: value.routeRef, mode: value.mode,
  selected_model_ref: value.selectedModelRef, account_binding: value.accountBinding, candidate_refs: value.candidateRefs, rejections: value.rejections,
  task_demand_hash: value.taskDemandHash, pressure: value.pressure, pressure_band: value.pressureBand, decision_layer: value.decisionLayer,
  overlay_version: value.overlayVersion, admission_binding_ref: value.admissionBindingRef, rationale: value.rationale, evidence: value, ...overrides,
});
const binding = { binding_id: "binding-1", execution_ref: "exec-1", invocation_ref: "inv-1", selected_model_provider: "provider", selected_model_id: "model", actual_model_provider: "provider", actual_model_id: "model" };

describe("routing evidence certification lineage", () => {
  it("blocks certification when routing evidence is missing", () => {
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [], nativeBindings: [], approvals: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_missing" }));
  });
  it("blocks a below-requirement model without an approval decision", () => {
    const value = route({ modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } } });
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });
  it("blocks a provider identity mismatch against the admission binding", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [{ ...binding, actual_model_id: "other" }], approvals: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_identity_mismatch" }));
  });
  it("blocks a mismatch between duplicated row identity and its canonical payload", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value, { pressure: 1 })], nativeBindings: [binding], approvals: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_identity_mismatch" }));
  });
});
