import { describe, expect, it } from "vitest";
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
  taskDemandHash: "a".repeat(64),
  pressure: 100,
  pressureBand: "high",
  decisionLayer: "Encore Council",
  overlayVersion: 2,
  admissionBindingRef: "binding-1",
  rationale: "selected after hard filters and matching",
  createdAt: "2026-09-08T12:00:00Z",
});
describe("routing evidence boundary", () => {
  it("accepts a complete selection record", () => expect(() => assertValidRoutingEvidence(evidence())).not.toThrow());
  it("rejects identity, authority, and hash boundary violations", () => {
    expect(() => assertValidRoutingEvidence({ ...evidence(), selectedModelRef: "model" })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), taskDemandHash: "bad" })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), authority: "ceo" })).toThrow(RoutingEvidenceValidationError);
  });
  it("rejects hostile object shapes and invalid pressure/band pairs at the value boundary", () => {
    const hostile = evidence() as Record<string, unknown>;
    Object.defineProperty(hostile, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidRoutingEvidence(hostile)).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), pressure: 201 })).toThrow(RoutingEvidenceValidationError);
    expect(() => assertValidRoutingEvidence({ ...evidence(), pressureBand: "low" as never })).toThrow(RoutingEvidenceValidationError);
  });
});
