import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES } from "./model-profile.js";
import {
  ROUTING_EVIDENCE_SCHEMA_VERSION,
  RoutingEvidenceValidationError,
  assertValidRoutingEvidence,
  type RoutingEvidence,
} from "./routing-evidence.js";
const evidence = (): RoutingEvidence => ({
  schemaVersion: ROUTING_EVIDENCE_SCHEMA_VERSION,
  evidenceId: "evidence-1",
  goalRef: "goal-1",
  projectRef: "project-1",
  routeRef: "route-1",
  mode: "ensemble",
  selectedModelRef: "provider/model",
  accountBinding: "account-1",
  candidateRefs: ["candidate-1"],
  rejections: [],
  taskDemandHash: "a".repeat(64),
  pressure: 100,
  pressureBand: "high",
  decisionLayer: "Encore Council",
  overlayVersion: 2,
  admissionBindingRef: "binding-1",
  rationale: "selected after hard filters and matching",
  createdAt: "2026-09-08T12:00:00Z",
  pressureCalculation: { pressureFloor: 200 / 3, pressure: 100, explicitHeadUplift: 100 },
        approvalIdentity: null,
  taskKindRecipeVersions: { coding: 1 },
  taskDemand: { schemaVersion: 1, taskKinds: ["coding"], requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])), provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
  workCharacter: { schemaVersion: 1, risk: 40, reversibility: 120, verificationAttachment: 80, materialScale: 20, timePressure: 30, budgetHeadroom: 150, provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
  modelProfile: { modelRef: "provider/model", capability: { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 180, rationale: "review", evidence: ["review-1"] }])) }, providerFacts: { schemaVersion: 1, contextCapacity: 128000, pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "docs", observedAt: "2026-09-08" } }, provenance: { owner: "human", sourceRefs: ["review-1"], reviewedAt: "2026-09-08" } },
  operationalOverlaySnapshot: { schemaVersion: 1, installationRef: "installation-1", projectRef: "project-1", goalRef: "goal-1", overlayVersion: 2, observations: [{ candidateRef: "candidate-1", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-08T12:00:00Z" }] },
  approvalRef: null,
});
describe("routing evidence boundary", () => {
  it("accepts a complete selection record", () => expect(() => assertValidRoutingEvidence(evidence())).not.toThrow());
  it("requires immutable routing inputs used for certification", () => {
    const incomplete = { ...evidence() }; delete (incomplete as Record<string, unknown>).taskDemand;
    expect(() => assertValidRoutingEvidence(incomplete)).toThrow(RoutingEvidenceValidationError);
  });
  it("rejects identity, authority, and hash boundary violations", () => {
    expect(() => assertValidRoutingEvidence({ ...evidence(), selectedModelRef: "model" })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), taskDemandHash: "bad" })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), authority: "ceo" })).toThrow(RoutingEvidenceValidationError);
  });
  it("requires replayable E pressure and known recipe versions", () => {
    expect(() => assertValidRoutingEvidence({ ...evidence(), pressureCalculation: { pressureFloor: 1, pressure: 100, explicitHeadUplift: 100 } })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), taskKindRecipeVersions: { coding: 999 } })).toThrow(RoutingEvidenceValidationError);
  });

  it("rejects hostile object shapes and invalid pressure/band pairs at the value boundary", () => {
    const hostile = evidence() as Record<string, unknown>;
    Object.defineProperty(hostile, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidRoutingEvidence(hostile)).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), pressure: 201 })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), pressureBand: "low" as never })).toThrow(RoutingEvidenceValidationError);
  });
});
