import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionBundle, TaskDemand } from "@maestro/domain";
import type { Pool } from "pg";
import { readHeadCouncil } from "./council.js";
import { readGoalOperationalOverlaySnapshot } from "./ensemble-router-artifacts.js";
import { readMissionBundle } from "./mission-bundle.js";
import { readRoutingWorkSnapshot } from "./routing-work-snapshot.js";

vi.mock("./council.js", () => ({ readHeadCouncil: vi.fn() }));
vi.mock("./ensemble-router-artifacts.js", () => ({ readGoalOperationalOverlaySnapshot: vi.fn() }));
vi.mock("./mission-bundle.js", () => ({ readMissionBundle: vi.fn() }));

const demand: TaskDemand = { schemaVersion: 1, taskKinds: ["coding"], requirements: Object.fromEntries(["reasoning", "coding", "verification", "instruction-fidelity", "tool-use", "long-context", "knowledge", "refusal-calibration"].map((axis) => [axis, { level: 80, rationale: "Head requirement" }])) as never, provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } };
const bundle = { councilId: "council-1", departmentId: "product", planVersion: 1, planContentHash: "plan-hash", itemId: "item-1", parentRef: "plan-item:item-1", contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", substance: { role: "execution", profileRef: "profile-1", goalBrief: "implement", taskDemand: demand, routingWorkInput: { schemaVersion: 1, workCharacter: { schemaVersion: 1, risk: 100, reversibility: 80, verificationAttachment: 120, materialScale: 50, timePressure: 40, budgetHeadroom: 100, provenance: demand.provenance }, explicitHeadUplift: 130 }, approvedModels: ["openai/model"], allowedSkills: ["coding"], allowedTools: ["read"], allowedPaths: ["packages"], environment: ["node24"], authorityBoundary: ["bounded"], externalServiceBoundary: ["none"], dataBoundary: ["workspace"], costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0, deliverable: "patch", evidenceRequirements: ["tests"], validationCriteria: ["tests pass"], terminationConditions: ["complete"] }, } as unknown as MissionBundle;
const overlay = { schemaVersion: 1 as const, installationRef: "installation-1", projectRef: "project-1", goalRef: "goal-1", overlayVersion: 1, observations: [{ candidateRef: "primary", measuredLatencyMs: 1, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "openai-account", observedAt: "2026-09-15T00:00:00.000Z" }] };
const request = { councilId: "council-1", departmentId: "product", planVersion: 1, itemId: "item-1", goalRef: "goal-1", projectRef: "project-1" };

beforeEach(() => { vi.mocked(readMissionBundle).mockResolvedValue(bundle); vi.mocked(readGoalOperationalOverlaySnapshot).mockResolvedValue(overlay); vi.mocked(readHeadCouncil).mockResolvedValue({ goalId: "goal-1", snapshot: { projectId: "project-1" } } as never); });

describe("durable routing work snapshot read", () => {
  it("composes the Mission Bundle and durable Goal overlay snapshot", async () => {
    const snapshot = await readRoutingWorkSnapshot({} as Pool, request);
    expect(snapshot.missionBundleRef).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(snapshot.operationalOverlay.goalRef).toBe("goal-1");
  });
  it("fails closed when the Goal overlay snapshot is missing", async () => {
    vi.mocked(readGoalOperationalOverlaySnapshot).mockResolvedValueOnce(null);
    await expect(readRoutingWorkSnapshot({} as Pool, request)).rejects.toThrow(/no durable operational overlay/i);
  });
  it("fails closed when the durable bundle has no explicit routing work input", async () => {
    vi.mocked(readMissionBundle).mockResolvedValueOnce({ ...bundle, substance: { ...bundle.substance, routingWorkInput: undefined } });
    await expect(readRoutingWorkSnapshot({} as Pool, request)).rejects.toThrow(/routingWorkInput|selector input/i);
  });
  it("fails closed on Goal/project cross-scope identity", async () => {
    vi.mocked(readHeadCouncil).mockResolvedValueOnce({ goalId: "other-goal", snapshot: { projectId: "project-1" } } as never);
    await expect(readRoutingWorkSnapshot({} as Pool, request)).rejects.toThrow(/binding|scope/i);
  });
});
