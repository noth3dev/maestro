import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, type RoutingEvidence } from "@maestro/domain";
import { evaluateRoutingEvidenceLineage, renderRoutingApprovalDecision, renderRoutingReportSections, type RoutingCapabilityApproval, type RoutingEvidenceCertificationRow } from "./concertmaster-report.js";

const route = (overrides: Partial<RoutingEvidence> = {}): RoutingEvidence => ({
  schemaVersion: 1, evidenceId: "evidence-1", goalRef: "goal-1", projectRef: "project-1", routeRef: "route-1", mode: "pin",
  selectedModelRef: "provider/model", accountBinding: "account-1", candidateRefs: ["candidate-1"], selectedCandidateRef: "candidate-1", rejections: [],
  taskDemandHash: "db8115791f3f3c95cfa335328821064eb1eb1effa295da88612e499aef5c841f", pressure: 100, pressureBand: "high", decisionLayer: "Encore Council", overlayVersion: 1,
  admissionBindingRef: "binding-1", rationale: "recorded route", createdAt: "2026-09-08T12:00:00Z",
  pressureCalculation: { pressureFloor: 200 / 3, pressure: 100, explicitHeadUplift: 100 },
        approvalIdentity: null, approvalRef: null,
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
  overlay_version: value.overlayVersion, admission_binding_ref: value.admissionBindingRef, rationale: value.rationale, created_at: value.createdAt, evidence: value, ...overrides,
});
const binding = { binding_id: "binding-1", execution_ref: "exec-1", invocation_ref: "inv-1", idempotency_key: "command-1", goal_id: "goal-1", project_id: "project-1", selected_model_provider: "provider", selected_model_id: "model", actual_model_provider: "provider", actual_model_id: "model", account_ref: "account-1", created_at: "2026-09-08T12:00:00Z" };

describe("routing evidence certification lineage", () => {
  it("blocks certification when routing evidence is missing", () => {
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [], nativeBindings: [], approvals: [], claims: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_missing" }));
  });
  it("blocks a below-requirement model without an approval decision", () => {
    const value = route({ modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } } });
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [], claims: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });
  it("accepts a below-requirement route only with an exact, in-window approval and consumed claim", () => {
    const value = route({
      modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } },
      approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" },
    });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required for the approved outcome.", consequence: "Only the recorded file is changed.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", admission_command_id: "command-1", snapshot_count: 1, snapshot_capability_kind: "ipython", snapshot_project_id: "project-1", snapshot_goal_id: "goal-1", snapshot_approval_id: "approval-1", snapshot_command_id: "command-1", snapshot_action: "project.file.edit", snapshot_target: "src/server.ts", snapshot_effect_index: "0", remaining_count_at_claim: 0, remaining_budget_cents_at_claim: null, repetition_expires_at_at_claim: null };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toEqual([]);
  });

  it("blocks a claim from an unrelated native admission", () => {
    const value = route({
      modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } },
      approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" },
    });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", admission_command_id: "different-admission", snapshot_count: 1 };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("does not infer admission identity from a matching command id", () => {
    const value = route({
      modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } },
      approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" },
    });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", snapshot_count: 0, remaining_count_at_claim: 0, remaining_budget_cents_at_claim: null, repetition_expires_at_at_claim: null };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("rejects ambiguous or duplicate claim-time snapshots", () => {
    const value = route({
      modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } },
      approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" },
    });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", admission_command_id: "command-1", remaining_count_at_claim: 0, remaining_budget_cents_at_claim: null, repetition_expires_at_at_claim: null, snapshot_count: 2 };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("rejects a claim-time snapshot whose journal identity differs from the claim", () => {
    const value = route({ modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } }, approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" } });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", admission_command_id: "command-1", snapshot_count: 1, snapshot_capability_kind: "ipython", snapshot_project_id: "project-1", snapshot_goal_id: "goal-1", snapshot_approval_id: "approval-1", snapshot_command_id: "command-1", snapshot_action: "project.file.edit", snapshot_target: "src/server.delete", snapshot_effect_index: "0", remaining_count_at_claim: 0, remaining_budget_cents_at_claim: null, repetition_expires_at_at_claim: null };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("rejects a shared approval when any matching effect claim lacks a unique snapshot", () => {
    const value = route({ modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } }, approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" } });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", admission_command_id: "command-1", snapshot_count: 1, snapshot_capability_kind: "ipython", snapshot_project_id: "project-1", snapshot_goal_id: "goal-1", snapshot_approval_id: "approval-1", snapshot_command_id: "command-1", snapshot_action: "project.file.edit", snapshot_target: "src/server.ts", snapshot_effect_index: "0", remaining_count_at_claim: 0, remaining_budget_cents_at_claim: null, repetition_expires_at_at_claim: null };
    const secondClaim = { ...claim, claim_id: "claim-2", effect_index: 1, snapshot_count: 0, snapshot_effect_index: "1" };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim, secondClaim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("blocks a claim after its bounded repetition window", () => {
    const value = route({
      modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } },
      approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" },
    });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_time", remaining_count: null, remaining_budget_cents: null, repetition_expires_at: "2026-09-08T11:30:00Z" };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T12:00:00Z", admission_command_id: "command-1", snapshot_count: 0 };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("blocks an account binding mismatch even when provider and model identities match", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [{ ...binding, account_ref: "other-account" }], approvals: [], claims: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_identity_mismatch" }));
  });

  it("renders approval scope, dissent, interruptions, and limitations", () => {
    const approval: RoutingCapabilityApproval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required for the approved outcome.", consequence: "Only the recorded file is changed.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-09T00:00:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    expect(renderRoutingApprovalDecision(approval, [])).toContain("actor=council-1; tier=Encore Council; scope=bounded_count(1 remaining); reason=Required for the approved outcome.; consequence=Only the recorded file is changed.");
    const sections = renderRoutingReportSections({ routingEvidence: [route({ approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" } })], approvals: new Map([[approval.approval_id, approval]]), journalByApproval: new Map(), journal: [{ event: "interruption", details: { didRun: "edit", didNotRun: "push" } }, { event: "safer_alternative", details: { dissent: "Use a review-only patch." } }], packetDissent: ["Council dissent"], limitations: ["unresolved: missing user acceptance"] });
    expect(sections.dissent).toEqual(["Council dissent", "Use a review-only patch."]);
    expect(sections.interruptionIncidents[0]).toContain("didNotRun");
    expect(sections.knownLimitations).toEqual(["unresolved: missing user acceptance", expect.stringContaining("interruption:")]);
  });

  it("checks approval expiry and revocation at capability claim time", () => {
    const value = route({ modelProfile: { ...route().modelProfile, capability: { ...route().modelProfile.capability, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 1, rationale: "low", evidence: ["review-1"] }])) } }, approvalRef: "approval-1", approvalIdentity: { capabilityKind: "ipython", commandId: "command-1", action: "project.file.edit", target: "src/server.ts" } });
    const approval = { approval_id: "approval-1", goal_id: "goal-1", project_id: "project-1", policy_version: 1, budget_effect_cents: 0, capability_kind: "ipython", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", tier: "Encore Council", approver_id: "council-1", decision: "approved", reason: "Required.", consequence: "Only the recorded file changes.", created_at: "2026-09-08T11:00:00Z", expires_at: "2026-09-08T12:30:00Z", revoked_at: null, scope_kind: "bounded_count", remaining_count: "1", remaining_budget_cents: null, repetition_expires_at: null };
    const claim = { claim_id: "claim-1", approval_id: "approval-1", capability_kind: "ipython", project_id: "project-1", goal_id: "goal-1", command_id: "command-1", action: "project.file.edit", target: "src/server.ts", policy_version: 1, budget_effect_cents: 0, effect_index: 0, consumed_at: "2026-09-08T13:00:00Z", snapshot_count: 0 };
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [approval], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [binding], approvals: [{ ...approval, expires_at: "2026-09-09T00:00:00Z", revoked_at: "2026-09-08T12:30:00Z" }], claims: [claim] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_unapproved_below_requirement" }));
  });

  it("requires admissionBindingRef to match binding_id rather than aliases", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [{ ...binding, binding_id: "other-binding", execution_ref: "binding-1" }], approvals: [], claims: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_binding_missing" }));
  });

  it("normalizes PostgreSQL bigint overlay versions during row binding", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value, { overlay_version: "1" })], nativeBindings: [binding], approvals: [], claims: [] }).blockers).toEqual([]);
  });

  it("blocks a provider identity mismatch against the admission binding", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value)], nativeBindings: [{ ...binding, actual_model_id: "other" }], approvals: [], claims: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_identity_mismatch" }));
  });
  it("blocks a mismatch between duplicated row identity and its canonical payload", () => {
    const value = route();
    expect(evaluateRoutingEvidenceLineage({ goalId: "goal-1", projectId: "project-1", routingRows: [row(value, { pressure: 1 })], nativeBindings: [binding], approvals: [], claims: [] }).blockers).toContainEqual(expect.objectContaining({ reason: "routing_evidence_identity_mismatch" }));
  });
});
