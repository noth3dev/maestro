import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, snapshotOperationalOverlayForGoal, type OperationalOverlay, type RoutingEvidence } from "@maestro/domain";
import type { Pool } from "pg";
import {
  EnsembleRouterArtifactIntegrityError,
  listRoutingEvidenceForGoal,
  readGoalOperationalOverlaySnapshot,
  readLatestOperationalOverlay,
  readRoutingEvidence,
  recordOperationalOverlay,
  recordRoutingEvidence,
  snapshotOperationalOverlayForGoalDurably,
} from "./ensemble-router-artifacts.js";

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
const overlay: OperationalOverlay = {
  schemaVersion: 1,
  installationRef: "installation-1",
  projectRef: "project-1",
  version: 1,
  observations: [
    {
      candidateRef: "candidate-1",
      measuredLatencyMs: 10,
      measuredCost: 0.01,
      failureRate: 0,
      timeoutRate: 0,
      providerErrorRate: 0,
      currentAvailability: true,
      accountBinding: "account-1",
      observedAt: "2026-09-08T12:00:00Z",
    },
  ],
};
const routingInputs = {
  taskKindRecipeVersions: { coding: 1 },
  taskDemand: { schemaVersion: 1, taskKinds: ["coding"], requirements: Object.fromEntries(["reasoning", "coding", "verification", "instruction-fidelity", "tool-use", "long-context", "knowledge", "refusal-calibration"].map((axis) => [axis, { level: 80, rationale: "Head requirement" }])), provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
  workCharacter: { schemaVersion: 1, risk: 40, reversibility: 120, verificationAttachment: 80, materialScale: 20, timePressure: 30, budgetHeadroom: 150, provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
  modelProfile: { modelRef: "provider/model", capability: { schemaVersion: 2, axes: Object.fromEntries(["reasoning", "coding", "verification", "instruction-fidelity", "tool-use", "long-context", "knowledge", "refusal-calibration"].map((axis) => [axis, { status: "scored", score: 180, rationale: "review", evidence: ["review-1"] }])) }, providerFacts: { schemaVersion: 1, contextCapacity: 128000, pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "docs", observedAt: "2026-09-08" } }, provenance: { owner: "human", sourceRefs: ["review-1"], reviewedAt: "2026-09-08" } },
  operationalOverlaySnapshot: { schemaVersion: 1, installationRef: "installation-1", projectRef: "project-1", goalRef: "goal-1", overlayVersion: 1, observations: [{ candidateRef: "candidate-1", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-08T12:00:00Z" }] }, approvalRef: null,
} as const;

const evidence: RoutingEvidence = {
  schemaVersion: 1,
  evidenceId: "evidence-1",
  goalRef: "goal-1",
  projectRef: "project-1",
  routeRef: "route-1",
  mode: "ensemble",
  selectedModelRef: "provider/model",
  accountBinding: "account-1",
  candidateRefs: ["candidate-1"],
  selectedCandidateRef: "candidate-1",
  rejections: [],
  taskDemandHash: "db8115791f3f3c95cfa335328821064eb1eb1effa295da88612e499aef5c841f",
  pressure: 100,
  pressureBand: "high",
  decisionLayer: "Encore Council",
  overlayVersion: 1,
  admissionBindingRef: "binding-1",
  rationale: "selected after hard filters",
  createdAt: "2026-09-08T12:00:00Z",
  pressureCalculation: { pressureFloor: 200 / 3, pressure: 100, explicitHeadUplift: 100 },
        approvalIdentity: null,
  ...routingInputs,
};

class FakePool {
  readonly calls: string[] = [];
  constructor(private readonly responses: unknown[][]) {}
  async query<T>(sql: string): Promise<{ rows: T[]; rowCount: number }> {
    this.calls.push(sql);
    const rows = (this.responses.shift() ?? []) as T[];
    return { rows, rowCount: rows.length };
  }
}
function pool(fake: FakePool): Pool {
  return fake as unknown as Pool;
}

describe("Ensemble Router artifact persistence", () => {
  it("validates before writing and preserves a versioned overlay", async () => {
    const fake = new FakePool([
      [
        {
          installation_ref: overlay.installationRef,
          project_ref: overlay.projectRef,
          version: overlay.version,
          overlay,
          content_hash: hash(overlay),
        },
      ],
    ]);
    await expect(recordOperationalOverlay(pool(fake), overlay)).resolves.toEqual(overlay);
    expect(fake.calls).toHaveLength(1);
    const invalid = { ...overlay, observations: [{ ...overlay.observations[0]!, currentAvailability: true, accountBinding: null }] };
    await expect(recordOperationalOverlay(pool(new FakePool([])), invalid)).rejects.toBeInstanceOf(EnsembleRouterArtifactIntegrityError);
  });

  it("reads and validates the latest overlay and immutable Goal snapshot", async () => {
    const snapshot = snapshotOperationalOverlayForGoal(overlay, "goal-1");
    const fake = new FakePool([
      [
        {
          installation_ref: overlay.installationRef,
          project_ref: overlay.projectRef,
          version: overlay.version,
          overlay,
          content_hash: hash(overlay),
        },
      ],
      [
        {
          installation_ref: overlay.installationRef,
          project_ref: overlay.projectRef,
          version: overlay.version,
          overlay,
          content_hash: hash(overlay),
        },
      ],
      [
        {
          goal_ref: snapshot.goalRef,
          installation_ref: snapshot.installationRef,
          project_ref: snapshot.projectRef,
          overlay_version: snapshot.overlayVersion,
          snapshot,
          content_hash: hash(snapshot),
        },
      ],
    ]);
    await expect(readLatestOperationalOverlay(fake, overlay.installationRef, overlay.projectRef)).resolves.toEqual(overlay);
    await expect(snapshotOperationalOverlayForGoalDurably(pool(fake), overlay, "goal-1")).resolves.toEqual(snapshot);
    await expect(readGoalOperationalOverlaySnapshot(new FakePool([]), "goal-1")).resolves.toBeNull();
  });

  it("persists routing evidence only when stored columns and JSON agree", async () => {
    const row = {
      ...evidence,
      evidence,
      evidence_id: evidence.evidenceId,
      goal_ref: evidence.goalRef,
      project_ref: evidence.projectRef,
      route_ref: evidence.routeRef,
      selected_model_ref: evidence.selectedModelRef,
      account_binding: evidence.accountBinding,
      candidate_refs: evidence.candidateRefs,
      rejections: evidence.rejections,
      task_demand_hash: evidence.taskDemandHash,
      pressure_band: evidence.pressureBand,
      decision_layer: evidence.decisionLayer,
      overlay_version: evidence.overlayVersion,
      admission_binding_ref: evidence.admissionBindingRef,
    };
    const fake = new FakePool([[row]]);
    await expect(recordRoutingEvidence(pool(fake), evidence)).resolves.toEqual(evidence);
    const read = new FakePool([[row]]);
    await expect(readRoutingEvidence(read, evidence.evidenceId)).resolves.toEqual(evidence);
    const list = new FakePool([[row]]);
    await expect(listRoutingEvidenceForGoal(list, evidence.goalRef)).resolves.toEqual([evidence]);
    const drift = new FakePool([[{ ...row, selected_model_ref: "other/model" }]]);
    await expect(readRoutingEvidence(drift, evidence.evidenceId)).rejects.toBeInstanceOf(EnsembleRouterArtifactIntegrityError);
    const rejectionDrift = new FakePool([
      [{ ...row, evidence: { ...evidence, rejections: [{ candidateRef: "candidate-1", reason: "drift" }] }, rejections: [] }],
    ]);
    await expect(readRoutingEvidence(rejectionDrift, evidence.evidenceId)).rejects.toBeInstanceOf(EnsembleRouterArtifactIntegrityError);
  });
});
