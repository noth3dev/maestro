import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, MODEL_CAPABILITY_SCHEMA_VERSION, type ModelMap } from "./model-profile.js";
import { snapshotOperationalOverlayForGoal, type OperationalOverlay } from "./operational-overlay.js";
import { MODEL_MAP_SCHEMA_VERSION } from "./model-map.js";
import { TASK_DEMAND_SCHEMA_VERSION, type TaskDemand } from "./task-demand.js";
import { RoutingSelectionError, selectRoutedModel, type RoutingSelectionRequest } from "./routing-selector.js";

const demand: TaskDemand = {
  schemaVersion: TASK_DEMAND_SCHEMA_VERSION,
  taskKinds: ["coding"],
  requirements: Object.fromEntries(
    MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }]),
  ) as TaskDemand["requirements"],
  provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" },
};
function modelMap(refs: readonly string[] = ["provider/fast", "provider/strong"]): ModelMap {
  return {
    schemaVersion: MODEL_MAP_SCHEMA_VERSION,
    entries: refs.map((modelRef, index) => ({
      modelRef,
      capability: {
        schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION,
        axes: Object.fromEntries(
          MODEL_CAPABILITY_AXES.map((axis) => [
            axis,
            { status: "scored", score: index === 1 ? 180 : 120, rationale: "human review", evidence: ["review-1"] },
          ]),
        ) as never,
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
function request(overrides: Partial<RoutingSelectionRequest> = {}): RoutingSelectionRequest {
  const overlay: OperationalOverlay = {
    schemaVersion: 1,
    installationRef: "installation-1",
    projectRef: "project-1",
    version: 1,
    observations: [
      {
        candidateRef: "fast",
        measuredLatencyMs: 10,
        measuredCost: 1,
        failureRate: 0.1,
        timeoutRate: 0,
        providerErrorRate: 0,
        currentAvailability: true,
        accountBinding: "account-1",
        observedAt: "2026-09-08T12:00:00Z",
      },
      {
        candidateRef: "strong",
        measuredLatencyMs: 20,
        measuredCost: 2,
        failureRate: 0.01,
        timeoutRate: 0,
        providerErrorRate: 0,
        currentAvailability: true,
        accountBinding: "account-1",
        observedAt: "2026-09-08T12:00:00Z",
      },
    ],
  };
  return {
    mode: "ensemble",
    goalRef: "goal-1",
    approvedModels: ["provider/fast", "provider/strong"],
    taskDemand: demand,
    modelMap: modelMap(),
    operationalOverlay: snapshotOperationalOverlayForGoal(overlay, "goal-1"),
    candidates: [
      { candidateRef: "fast", modelRef: "provider/fast", accountBinding: "account-1" },
      { candidateRef: "strong", modelRef: "provider/strong", accountBinding: "account-1" },
    ],
    pressure: 140,
    ...overrides,
  };
}

describe("A/B/C routing selection", () => {
  it("selects one exact model identity from the approved, bound hard-filtered set", () => {
    const selected = selectRoutedModel(request());
    expect(selected.selectedCandidateRef).toBe("strong");
    expect(selected.selectedModelRef).toBe("provider/strong");
    expect(selected.candidateRefs).toEqual(["strong", "fast"]);
    expect(selected.pressure.band).toBe("high");
    expect(selected.rationale).toContain("does not alter TaskDemand or authority");
  });
  it("fails closed for absent model-map entries and unavailable or mismatched account observations", () => {
    expect(() => selectRoutedModel(request({ modelMap: modelMap(["provider/other"]), approvedModels: ["provider/other"] }))).toThrow(
      RoutingSelectionError,
    );
    const current = request().operationalOverlay;
    const unavailable = request({
      operationalOverlay: snapshotOperationalOverlayForGoal(
        {
          schemaVersion: current.schemaVersion,
          installationRef: current.installationRef,
          projectRef: current.projectRef,
          version: current.overlayVersion,
          observations: [{ ...current.observations[0]!, currentAvailability: false }, current.observations[1]!],
        },
        "goal-1",
      ),
    });
    expect(selectRoutedModel(unavailable).selectedCandidateRef).toBe("strong");
    expect(() =>
      selectRoutedModel(
        request({ candidates: [{ candidateRef: "strong", modelRef: "provider/strong", accountBinding: "wrong-account" }] }),
      ),
    ).toThrow(RoutingSelectionError);
  });
  it("uses D requirements as a weakest-link hard filter against every A axis", () => {
    const demanding = {
      ...request().taskDemand,
      requirements: { ...request().taskDemand.requirements, coding: { level: 181, rationale: "D requires a stronger coding capability" } },
    };
    expect(() => selectRoutedModel(request({ taskDemand: demanding }))).toThrow(RoutingSelectionError);
    const selected = selectRoutedModel(
      request({
        taskDemand: {
          ...demanding,
          requirements: { ...demanding.requirements, coding: { level: 180, rationale: "D matches the strongest A score" } },
        },
      }),
    );
    expect(selected.selectedModelRef).toBe("provider/strong");
  });

  it("keeps pin mode explicit and rejects contradictory identity inputs", () => {
    const selected = selectRoutedModel(request({ mode: "pin", pinModelRef: "provider/fast" }));
    expect(selected.selectedModelRef).toBe("provider/fast");
    expect(() => selectRoutedModel(request({ mode: "ensemble", pinModelRef: "provider/fast" }))).toThrow(RoutingSelectionError);
    expect(() => selectRoutedModel(request({ mode: "pin", pinModelRef: "provider/missing" }))).toThrow(RoutingSelectionError);
  });
});
