import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, type ModelMap, type RoutingWorkSnapshot } from "@maestro/domain";
import type { MaestroConfig } from "./config.js";
import { createEnsembleNativeAdmission } from "./ensemble-admission.js";

const config = {
  modelRoutingMode: "ensemble", nativeModelRef: undefined, modelAccountRefs: { openai: "openai-account", anthropic: "anthropic-account" }, worktreeRoot: "/workspace", actorId: "control",
} as unknown as MaestroConfig;

const modelMap: ModelMap = {
  schemaVersion: 1,
  entries: [{
    modelRef: "openai/model-strong",
    capability: { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 180, rationale: "human score", evidence: ["review-1"] }])) as never },
    providerFacts: { schemaVersion: 1, contextCapacity: 128_000, pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["workspace"], retention: "transient", trainingUse: "never", regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "review-1", observedAt: "2026-09-15" } },
    provenance: { owner: "human", sourceRefs: ["review-1"], reviewedAt: "2026-09-15" },
  }],
};

const taskDemand = {
  schemaVersion: 1 as const, taskKinds: ["coding"] as const,
  requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])) as never,
  provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" },
};

const snapshot: RoutingWorkSnapshot = {
  schemaVersion: 1, goalRef: "goal-1", projectRef: "project-1", missionBundleRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approvedModels: ["openai/model-strong"], taskDemand,
  routingWorkInput: { schemaVersion: 1, workCharacter: { schemaVersion: 1, risk: 120, reversibility: 60, verificationAttachment: 100, materialScale: 50, timePressure: 80, budgetHeadroom: 100, provenance: taskDemand.provenance }, explicitHeadUplift: 130 },
  operationalOverlay: { schemaVersion: 1, installationRef: "installation-1", projectRef: "project-1", goalRef: "goal-1", overlayVersion: 2, observations: [{ candidateRef: "strong-primary", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "openai-account", observedAt: "2026-09-15T00:00:00.000Z" }] },
};

const base = {
  context: { operatorId: "head-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", policyVersion: "policy-1", authorityPolicyVersion: 1, budgetEffectCents: 0, fencingToken: "1" },
  grant: { grantId: "grant-1", allowedTools: ["read"], allowedSkills: ["coding"], pathScope: ["packages"], outboundDataClasses: ["workspace"], remaining: { modelTurns: 8, toolCalls: 8, childCalls: 0, outputTokens: 8192, wallTimeMs: 120000, retryCount: 0 } },
  idempotencyKey: "command-1",
};

describe("ensemble native admission", () => {
  it("selects from the explicit catalog and emits durable-evidence input", () => {
    const decision = createEnsembleNativeAdmission(config, { snapshot, modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" }], routeRef: "worker:worker-1:1", base });
    expect(decision.admission.modelPolicy).toEqual(["openai/model-strong"]);
    expect(decision.routingEvidence.selectedCandidateRef).toBe("strong-primary");
    expect(decision.routingEvidence.admissionBindingRef).toBeUndefined();
    expect(decision.routingEvidence.createdAt).toBeUndefined();
    expect(decision.routingEvidence.approvalRef).toBeNull();
  });

  it("rejects project-scoped context before ensemble worker routing", () => {
    expect(() => createEnsembleNativeAdmission(config, {
      snapshot,
      modelMap,
      candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" }],
      routeRef: "worker:worker-1:1",
      base: { ...base, context: { ...base.context, goalId: undefined } },
    })).toThrow("Goal binding");
  });

  it("does not invent pressure or route when the work-character input is absent", () => {
    expect(() => createEnsembleNativeAdmission(config, { snapshot: { ...snapshot, routingWorkInput: undefined } as never, modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" }], routeRef: "worker:worker-1:1", base })).toThrow(/work|pressure|routing/i);
  });

  it("binds the route to the same project and Mission Bundle as native admission", () => {
    expect(() => createEnsembleNativeAdmission(config, { snapshot: { ...snapshot, projectRef: "other-project" }, modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" }], routeRef: "worker:worker-1:1", base })).toThrow(/project/i);
    expect(() => createEnsembleNativeAdmission(config, { snapshot: { ...snapshot, missionBundleRef: "other-bundle" }, modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" }], routeRef: "worker:worker-1:1", base })).toThrow(/Mission Bundle/i);
  });

  it("escalates an unmet candidate set through the calculated pressure authority", () => {
    expect(() => createEnsembleNativeAdmission(config, { snapshot, modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "wrong-account" }], routeRef: "worker:worker-1:1", base })).toThrow(/Encore Council|user|Department Head|automatic progress/);
    try {
      createEnsembleNativeAdmission(config, { snapshot, modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "wrong-account" }], routeRef: "worker:worker-1:1", base });
    } catch (error) {
      expect(error).toMatchObject({ name: "EnsembleRoutingShortfallError", shortfall: { pressure: { decisionLayer: "Encore Council" }, rejected: [{ candidateRef: "strong-primary" }] } });
    }
  });

  it("revalidates hostile snapshot boundaries before selecting a route", () => {
    expect(() => createEnsembleNativeAdmission(config, {
      snapshot: { ...snapshot, routingWorkInput: { ...snapshot.routingWorkInput, workCharacter: { ...snapshot.routingWorkInput!.workCharacter, provenance: { taskContractRef: "forged", headDecisionRef: "forged" } } } },
      modelMap, candidates: [{ candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" }], routeRef: "worker:worker-1:1", base,
    })).toThrow(/provenance|TaskDemand/i);
  });

  it("passes only eligible candidates to the shared admission validator", () => {
    const decision = createEnsembleNativeAdmission(config, { snapshot, modelMap, candidates: [
      { candidateRef: "strong-primary", modelRef: "openai/model-strong", accountBinding: "openai-account" },
      { candidateRef: "unapproved", modelRef: "openai/model-strong", accountBinding: "openai-account" },
    ], routeRef: "worker:worker-1:1", base });
    expect(decision.admission.modelPolicy).toEqual(["openai/model-strong"]);
  });
});
