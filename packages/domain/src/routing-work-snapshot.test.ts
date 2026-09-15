import { describe, expect, it } from "vitest";
import { assertValidRoutingWorkSnapshot, createRoutingWorkSnapshot, RoutingWorkSnapshotValidationError, type RoutingWorkSnapshotInput } from "./routing-work-snapshot.js";

const taskDemand = {
  schemaVersion: 1 as const,
  taskKinds: ["coding"] as const,
  requirements: Object.fromEntries(["reasoning", "coding", "verification", "instruction-fidelity", "tool-use", "long-context", "knowledge", "refusal-calibration"].map((axis) => [axis, { level: 80, rationale: "Head-set requirement" }])) as never,
  provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
};

const workInput = {
  schemaVersion: 1 as const,
  workCharacter: {
    schemaVersion: 1 as const, risk: 120, reversibility: 60, verificationAttachment: 100, materialScale: 50, timePressure: 80, budgetHeadroom: 100,
    provenance: taskDemand.provenance,
  },
  explicitHeadUplift: 130,
};

const overlay = {
  schemaVersion: 1 as const, installationRef: "installation-1", projectRef: "project-1", goalRef: "goal-1", overlayVersion: 4,
  observations: [{ candidateRef: "sol-primary", measuredLatencyMs: 10, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "openai-account", observedAt: "2026-09-15T00:00:00.000Z" }],
};

const input = (overrides: Partial<RoutingWorkSnapshotInput> = {}): RoutingWorkSnapshotInput => ({
  goalRef: "goal-1", projectRef: "project-1", missionBundleRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approvedModels: ["openai/gpt-5.6-sol"], taskDemand, routingWorkInput: workInput, operationalOverlay: overlay, ...overrides,
});

describe("Goal/work routing snapshot", () => {
  it("creates a sealed selector input from explicit work and Goal-scoped overlay data", () => {
    const snapshot = createRoutingWorkSnapshot(input());
    expect(snapshot.goalRef).toBe("goal-1");
    expect(snapshot.projectRef).toBe("project-1");
    expect(snapshot.routingWorkInput.workCharacter.risk).toBe(120);
    expect(snapshot.operationalOverlay.overlayVersion).toBe(4);
  });

  it("rejects a missing work-character contract instead of deriving pressure", () => {
    expect(() => createRoutingWorkSnapshot(input({ routingWorkInput: undefined }))).toThrow(RoutingWorkSnapshotValidationError);
  });

  it("requires the Mission Bundle content hash rather than an arbitrary route label", () => {
    expect(() => createRoutingWorkSnapshot(input({ missionBundleRef: "bundle-label" }))).toThrow(/SHA-256|hash/i);
  });

  it("rejects an overlay snapshot bound to another Goal or project", () => {
    expect(() => createRoutingWorkSnapshot(input({ operationalOverlay: { ...overlay, goalRef: "other-goal" } }))).toThrow(/Goal|overlay/i);
    expect(() => createRoutingWorkSnapshot(input({ operationalOverlay: { ...overlay, projectRef: "other-project" } }))).toThrow(/project|overlay/i);
  });

  it("rejects accessors/inherited fields and deep-freezes the selector input", () => {
    const hostile = { ...input() } as Record<string, unknown>;
    Object.defineProperty(hostile, "goalRef", { enumerable: true, get: () => "goal-1" });
    expect(() => createRoutingWorkSnapshot(hostile as never)).toThrow(RoutingWorkSnapshotValidationError);
    const snapshot = createRoutingWorkSnapshot(input());
    expect(() => assertValidRoutingWorkSnapshot(snapshot)).not.toThrow();
    expect(Object.isFrozen(snapshot.operationalOverlay.observations[0])).toBe(true);
    expect(() => { (snapshot.operationalOverlay.observations[0] as { measuredCost: number }).measuredCost = 99; }).toThrow();
  });
});
