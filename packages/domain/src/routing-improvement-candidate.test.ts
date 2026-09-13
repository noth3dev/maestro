import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, MODEL_CAPABILITY_SCHEMA_VERSION, type ModelMap } from "./model-profile.js";
import { MODEL_MAP_SCHEMA_VERSION } from "./model-map.js";
import { snapshotOperationalOverlayForGoal, type OperationalOverlay } from "./operational-overlay.js";
import { TASK_DEMAND_SCHEMA_VERSION, type TaskDemand } from "./task-demand.js";
import { materializeImprovementCandidate, improvementCandidateScenarioSuiteHash, type ImprovementCandidate, type ImprovementCandidateInput } from "./improvement-candidate.js";
import type { EncoreJudgmentSubstance } from "./encore-council.js";
import { createRoutingCapabilityCandidate, selectRoutedModelWithRoutingCandidate, type RoutingCapabilityCouncilJudgment } from "./routing-improvement-candidate.js";
import { selectRoutedModel } from "./routing-selector.js";
import type { RoutingSelectionRequest } from "./routing-selector.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const DIGEST_ID = "33333333-3333-4333-8333-333333333333";
const BASELINE_ID = "44444444-4444-4444-8444-444444444444";
const CANDIDATE_ID = "55555555-5555-4555-8555-555555555555";
const UPDATED_CANDIDATE_ID = "66666666-6666-4666-8666-666666666666";

const demand: TaskDemand = {
  schemaVersion: TASK_DEMAND_SCHEMA_VERSION,
  taskKinds: ["coding"],
  requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 120, rationale: "Head requirement" }])) as TaskDemand["requirements"],
  provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" },
};

function modelMap(score = 120): ModelMap {
  return {
    schemaVersion: MODEL_MAP_SCHEMA_VERSION,
    entries: ["provider/fast", "provider/strong"].map((modelRef, index) => ({
      modelRef,
      capability: {
        schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION,
        axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: index === 0 ? score : 180, rationale: "human review", evidence: ["review-1"] }])) as never,
      },
      providerFacts: {
        schemaVersion: 1,
        contextCapacity: 128_000,
        pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        authentication: { modes: ["api-key"] },
        dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] },
        modalities: ["text"],
        toolCalls: { supported: true },
        provenance: { source: "provider docs", observedAt: "2026-09-08" },
      },
      provenance: { owner: "human", sourceRefs: ["review-1"], reviewedAt: "2026-09-08" },
    })),
  };
}

const overlay: OperationalOverlay = {
  schemaVersion: 1,
  installationRef: "installation-1",
  projectRef: PROJECT_ID,
  version: 1,
  observations: [
    { candidateRef: "fast", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0.1, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-08T12:00:00Z" },
    { candidateRef: "strong", measuredLatencyMs: 20, measuredCost: 2, failureRate: 0.01, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-08T12:00:00Z" },
  ],
};

function request(overrides: Partial<RoutingSelectionRequest> = {}): RoutingSelectionRequest {
  return {
    mode: "ensemble",
    goalRef: GOAL_ID,
    approvedModels: ["provider/fast", "provider/strong"],
    taskDemand: demand,
    modelMap: modelMap(),
    operationalOverlay: snapshotOperationalOverlayForGoal(overlay, GOAL_ID),
    candidates: [
      { candidateRef: "fast", modelRef: "provider/fast", accountBinding: "account-1" },
      { candidateRef: "strong", modelRef: "provider/strong", accountBinding: "account-1" },
    ],
    pressure: 140,
    ...overrides,
  };
}

function candidateInput(overrides: Partial<ImprovementCandidateInput> = {}): ImprovementCandidateInput {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    kind: "routing_capability_axis",
    target: { roleId: "head-engineering", taskClass: "implementation", routingTarget: "provider/fast" },
    changes: [{ axis: "coding", currentValue: 120, proposedValue: 140 }],
    sourceEvidenceIds: [DIGEST_ID],
    evidencePattern: "Comparable Goals show a repeatable verification gap.",
    predictedEffect: "The project will route coding work to the corrected capability profile.",
    expectedMetrics: [{ name: "verification_failures", unit: "count", direction: "decrease", target: 0 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9 }],
    scenarioSuite: ["routing-capability-v1"],
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["routing-capability-v1"]),
    confidence: 0.84,
    dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: { candidateId: BASELINE_ID, version: 1, contentHash: "0".repeat(64) },
    ...overrides,
  };
}

function materialized(state: ImprovementCandidate["state"] = "candidate"): ImprovementCandidate {
  return materializeImprovementCandidate(candidateInput(), {
    candidateId: state === "candidate" ? CANDIDATE_ID : UPDATED_CANDIDATE_ID,
    version: 1,
    parentCandidateId: null,
    state,
    authorId: "encore-lab",
    sessionRef: "session:routing:1",
    createdAt: "2026-09-13T12:00:00.000Z",
  });
}

function judgmentFor(candidate: ImprovementCandidate): RoutingCapabilityCouncilJudgment {
  const judgment = (modelProvider: string, modelId: string): EncoreJudgmentSubstance => ({
    modelProvider,
    modelId,
    verdict: "proceed",
    confidence: "high",
    reasoning: "durable evidence supports the bounded proposal",
    conditions: [],
    dissentNote: null,
    citedEvidenceIds: [DIGEST_ID],
  });
  return {
    candidateId: candidate.candidateId,
    candidateVersion: candidate.version,
    candidateContentHash: candidate.contentHash,
    councilRoundId: "encore-round-routing-1",
    evidenceIds: [DIGEST_ID],
    judgments: [judgment("test", "kimi"), judgment("openai", "gpt")],
  };
}

describe("routing learning integration", () => {
  it("excludes an unavailable model from current routing without changing its A capability judgment", () => {
    const before = request();
    const unavailable = snapshotOperationalOverlayForGoal({ ...overlay, observations: [{ ...overlay.observations[0]!, currentAvailability: false }, overlay.observations[1]!] }, GOAL_ID);
    const selected = selectRoutedModel({ ...before, operationalOverlay: unavailable });

    expect(selected.selectedModelRef).toBe("provider/strong");
    expect(before.modelMap.entries[0]!.capability.axes.coding.score).toBe(120);
    expect(unavailable.observations[0]!.currentAvailability).toBe(false);
  });

  it("adapts a capability proposal to the shared candidate schema and blocks it before Council judgment", () => {
    const candidate = createRoutingCapabilityCandidate(candidateInput());
    expect(candidate).toMatchObject({ kind: "routing_capability_axis", target: { roleId: "head-engineering", taskClass: "implementation", routingTarget: "provider/fast" }, changes: [{ axis: "coding" }] });
    expect(() => selectRoutedModelWithRoutingCandidate(request({ taskDemand: { ...demand, requirements: { ...demand.requirements, coding: { level: 140, rationale: "needs the proposed increase" } } } }), materialized(), judgmentFor(materialized()))).toThrow(/Council|judg|proposal/i);
  });

  it("requires routing rollouts to carry an explicit role and task scope", () => {
    expect(() => createRoutingCapabilityCandidate({ ...candidateInput(), target: { routingTarget: "provider/fast" } })).toThrow(/scope|roleId|taskClass/i);
  });

  it("keeps a project overlay independent when the human model_map baseline changes", () => {
    const snapshot = snapshotOperationalOverlayForGoal(overlay, GOAL_ID);
    const before = request({ modelMap: modelMap(120), operationalOverlay: snapshot });
    const afterHumanBaselineUpdate = request({ modelMap: modelMap(190), operationalOverlay: snapshot });

    expect(selectRoutedModel(before).selectedModelRef).toBe("provider/strong");
    expect(selectRoutedModel(afterHumanBaselineUpdate).selectedModelRef).toBe("provider/fast");
    expect(snapshot.overlayVersion).toBe(1);
    expect(snapshot.observations[0]!.measuredLatencyMs).toBe(10);
    expect(before.modelMap.entries[0]!.capability.axes.coding.score).toBe(120);
  });

  it("does not let a routing proposal mutate the baseline even after Council judgment", () => {
    const judged = materialized("judged");
    const route = request({
      approvedModels: ["provider/fast"],
      candidates: [{ candidateRef: "fast", modelRef: "provider/fast", accountBinding: "account-1" }],
      taskDemand: { ...demand, requirements: { ...demand.requirements, coding: { level: 140, rationale: "requires the human baseline" } } },
    });

    expect(() => selectRoutedModelWithRoutingCandidate(route, judged, judgmentFor(judged))).toThrow(/capability|No candidate|baseline|requirement/i);
    expect(route.modelMap.entries[0]!.capability.axes.coding.score).toBe(120);
    expect(judged.changes[0]!.proposedValue).toBe(140);
  });

  it("keeps single-execution evidence as a proposal and preserves the rollback/evidence chain", () => {
    const singleExecution = materialized();
    const withSingleEpisode = createRoutingCapabilityCandidate(candidateInput({ dataSufficiency: { episodeCount: 1, comparableGoalCount: 1 } }));
    const judgedSingleExecution = materializeImprovementCandidate(
      candidateInput({ dataSufficiency: { episodeCount: 1, comparableGoalCount: 1 } }),
      { candidateId: UPDATED_CANDIDATE_ID, version: 1, parentCandidateId: null, state: "judged", authorId: "encore-lab", sessionRef: "session:routing:single", createdAt: "2026-09-13T12:00:00.000Z" },
    );

    expect(singleExecution.state).toBe("candidate");
    expect(withSingleEpisode.sourceEvidenceIds).toEqual([DIGEST_ID]);
    expect(withSingleEpisode.rollbackTarget).toEqual(candidateInput().rollbackTarget);
    expect(() => selectRoutedModelWithRoutingCandidate(request(), singleExecution, judgmentFor(singleExecution))).toThrow(/Council|judg|proposal/i);
    expect(() => selectRoutedModelWithRoutingCandidate(request(), judgedSingleExecution, judgmentFor(judgedSingleExecution))).toThrow(/single|comparable|sufficient|episode/i);
  });
});
