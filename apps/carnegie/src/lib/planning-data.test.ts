import { describe, expect, it, vi } from "vitest";
import {
  activateDepartmentHead,
  currentPlanningStage,
  decideHeadCouncil,
  loadHeadCouncil,
  openHeadCouncil,
  revealHeadCouncil,
  selectOvertureRolesForContract,
  submitDepartmentBrief,
  type PlanningApi,
} from "./planning-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";
const councilId = "44444444-4444-4444-8444-444444444444";
const commandId = "55555555-5555-4555-8555-555555555555";

function fakeApi(overrides: Partial<PlanningApi> = {}): PlanningApi {
  return {
    selectOvertureRoles: vi.fn().mockResolvedValue({ contractId, selectionId: "sel-1", roles: ["engineering"] }),
    activateHead: vi.fn().mockResolvedValue({ goalId, departmentId: "engineering", headRoleId: "head-eng", contractId, contextId: null, status: "active", activeSessionRef: "session-1" }),
    createCouncil: vi.fn().mockResolvedValue({ councilId, goalId, contractId, briefDeadline: "2026-01-01T00:00:00.000Z", state: "collecting", noNewEvidenceStreak: 0, decisionPacket: null, snapshotHash: "a".repeat(64), snapshot: {} }),
    getCouncil: vi.fn().mockResolvedValue({ councilId, goalId, contractId, briefDeadline: "2026-01-01T00:00:00.000Z", state: "resolved", noNewEvidenceStreak: 0, decisionPacket: {}, snapshotHash: "a".repeat(64), snapshot: {} }),
    submitCouncilBrief: vi.fn().mockResolvedValue(undefined),
    revealCouncil: vi.fn().mockResolvedValue(undefined),
    decideCouncil: vi.fn().mockResolvedValue({ councilId, goalId, contractId, briefDeadline: "2026-01-01T00:00:00.000Z", state: "resolved", noNewEvidenceStreak: 0, decisionPacket: {}, snapshotHash: "a".repeat(64), snapshot: {} }),
    getDepartmentPlan: vi.fn(),
    getMissionBundle: vi.fn(),
    ...overrides,
  };
}

describe("planning stage transitions use the previous stage's real server IDs", () => {
  it("selects Overture roles against the real contract id and command id", async () => {
    const api = fakeApi();
    const result = await selectOvertureRolesForContract(api, contractId, { outsideEvidenceRequested: false, previewNeeded: true }, commandId);
    expect(api.selectOvertureRoles).toHaveBeenCalledWith(contractId, { outsideEvidenceRequested: false, previewNeeded: true }, commandId);
    expect(result.roles).toEqual(["engineering"]);
  });

  it("activates a Head against the real Goal id", async () => {
    const api = fakeApi();
    const input = { projectId, departmentId: "engineering", requestedContribution: "review", urgency: "normal", contextScope: ["repo"], budgetEffect: "none", reason: "planning" };
    await activateDepartmentHead(api, goalId, input, commandId);
    expect(api.activateHead).toHaveBeenCalledWith(goalId, input, commandId);
  });

  it("creates a Council against the real Goal id and the real contract id from Overture/Head, not a sample id", async () => {
    const api = fakeApi();
    const input = { projectId, contractId, briefDeadline: "2026-01-01T00:00:00.000Z", evidence: {} };
    const council = await openHeadCouncil(api, goalId, input, commandId);
    expect(api.createCouncil).toHaveBeenCalledWith(goalId, input, commandId);
    expect(council.councilId).toBe(councilId);
  });

  it("submits a brief scoped to the real councilId and the caller's own departmentId", async () => {
    const api = fakeApi();
    const brief = { projectId, brief: { interpretation: "x", contribution: "y", nonGoals: ["n"], assumptions: ["a"], evidenceGaps: ["e"], risks: ["r"], dependencies: ["d"], proposedValidation: ["v"], expectedWorkers: ["w"], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: ["o"] } };
    await submitDepartmentBrief(api, councilId, "engineering", brief, commandId);
    expect(api.submitCouncilBrief).toHaveBeenCalledWith(councilId, "engineering", brief, commandId);
  });

  it("reveal does not run automatically -- it is a separate, explicit call", async () => {
    const api = fakeApi();
    await revealHeadCouncil(api, councilId, projectId, commandId);
    expect(api.revealCouncil).toHaveBeenCalledWith(councilId, projectId, commandId);
    expect(api.decideCouncil).not.toHaveBeenCalled();
  });

  it("decide does not run automatically after reveal -- it is a separate, explicit call", async () => {
    const api = fakeApi();
    const packet = { outcome: "decided" as const, executionDisposition: "executable" as const, selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
    const decided = await decideHeadCouncil(api, councilId, { projectId, packet }, commandId);
    expect(api.decideCouncil).toHaveBeenCalledWith(councilId, { projectId, packet }, commandId);
    expect(decided.state).toBe("resolved");
  });

  it("reloads Council state through the durable GET method, not local cached state", async () => {
    const api = fakeApi();
    const loaded = await loadHeadCouncil(api, councilId, projectId);
    expect(api.getCouncil).toHaveBeenCalledWith(councilId, projectId);
    expect(loaded.state).toBe("resolved");
  });

  it("generates a fresh command id when the caller does not supply one", async () => {
    const api = fakeApi();
    await revealHeadCouncil(api, councilId, projectId);
    const [, , usedCommandId] = (api.revealCouncil as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    expect(usedCommandId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("currentPlanningStage", () => {
  const resolvedCouncil = { councilId, goalId, contractId, briefDeadline: "2026-01-01T00:00:00.000Z", state: "resolved" as const, noNewEvidenceStreak: 0, decisionPacket: {}, snapshotHash: "a".repeat(64), snapshot: {} };
  const collectingCouncil = { ...resolvedCouncil, state: "collecting" as const };

  it("does not permit a later stage before its prerequisite completes", () => {
    expect(currentPlanningStage({ overtureSelected: false, headActive: false, council: undefined, departmentPlanExists: false, missionBundleExists: false })).toBe("overture");
    expect(currentPlanningStage({ overtureSelected: true, headActive: false, council: undefined, departmentPlanExists: false, missionBundleExists: false })).toBe("head");
    expect(currentPlanningStage({ overtureSelected: true, headActive: true, council: undefined, departmentPlanExists: false, missionBundleExists: false })).toBe("council");
    expect(currentPlanningStage({ overtureSelected: true, headActive: true, council: collectingCouncil, departmentPlanExists: false, missionBundleExists: false })).toBe("council");
  });

  it("advances only once the Council is actually resolved, not merely created", () => {
    expect(currentPlanningStage({ overtureSelected: true, headActive: true, council: resolvedCouncil, departmentPlanExists: false, missionBundleExists: false })).toBe("department-plan");
    expect(currentPlanningStage({ overtureSelected: true, headActive: true, council: resolvedCouncil, departmentPlanExists: true, missionBundleExists: false })).toBe("mission-bundle");
    expect(currentPlanningStage({ overtureSelected: true, headActive: true, council: resolvedCouncil, departmentPlanExists: true, missionBundleExists: true })).toBe("ready-for-worker");
  });
});
