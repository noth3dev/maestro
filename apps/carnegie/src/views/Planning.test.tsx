import React, { type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Planning } from "./Planning.js";

const planningMode = vi.hoisted(() => ({ value: "overture" as "overture" | "bundle", stateCall: 0 }));
const spawnMissionBundle = vi.hoisted(() => vi.fn().mockResolvedValue({ workerId: "worker-1" }));
const api = vi.hoisted(() => ({
  selectOvertureRoles: vi.fn().mockResolvedValue({ contractId: "33333333-3333-4333-8333-333333333333", selectionId: "selection-1", roles: [] }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => undefined,
    useState: (initial: unknown) => {
      const call = planningMode.stateCall++;
      if (planningMode.value === "bundle" && call === 1) return [true, vi.fn()];
      if (planningMode.value === "bundle" && call === 2) return [{ status: "active", departmentId: "engineering", headRoleId: "head-1" }, vi.fn()];
      if (planningMode.value === "bundle" && call === 3) return [{ state: "resolved", councilId: "33333333-3333-4333-8333-333333333333" }, vi.fn()];
      if (planningMode.value === "bundle" && call === 4) return [{
        projectId: "11111111-1111-4111-8111-111111111111",
        goalId: "22222222-2222-4222-8222-222222222222",
        councilId: "33333333-3333-4333-8333-333333333333",
        contractId: "contract-1",
        departmentId: "engineering",
        headRoleId: "head-1",
        version: 2,
        contentHash: "b".repeat(64),
        substance: {
          contribution: "Build the hero section",
          items: [{ itemId: "hero-section", kind: "coding", objective: "Build the hero section", dependsOn: [], workerAssignment: "worker", evidenceReferences: [] }],
          nonGoals: [], requiredHandoffs: [], budgetCeiling: "10 cents", expectedTime: "10 minutes", maxRetries: 1, maxWorkers: 1,
          gitRepository: "repo", gitBranch: "main", integrationPath: "apps/carnegie", risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: [],
        },
      }, vi.fn()];
      if (planningMode.value === "bundle" && call === 5) return [{
        councilId: "33333333-3333-4333-8333-333333333333", departmentId: "engineering", planVersion: 2, planContentHash: "b".repeat(64), itemId: "hero-section", parentRef: "department-plan:engineering:2", contentHash: "a".repeat(64), substance: {
          role: "execution", profileRef: "profile:engineering", goalBrief: "Build the hero section",
          approvedModels: ["openai-codex/gpt-5.6-luna"], allowedSkills: ["testing"], allowedTools: ["read"], allowedPaths: ["apps/carnegie"], environment: ["test"],
          authorityBoundary: ["bounded"], externalServiceBoundary: ["none"], dataBoundary: ["workspace"], costCeiling: "10 cents", timeCeiling: "10 minutes", retryCeiling: 1, workerCeiling: 1,
          deliverable: "hero section", evidenceRequirements: ["test log"], validationCriteria: ["tests pass"], terminationConditions: ["done"],
        } as never,
      }, vi.fn()];
      return [initial, vi.fn()];
    },
  };
});
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", contractId: "33333333-3333-4333-8333-333333333333" }], selectedGoalId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("../components/EmptyState.js", () => ({ EmptyState: () => null }));
vi.mock("../components/ApiErrorNotice.js", () => ({ ApiErrorNotice: () => null }));
vi.mock("../lib/worker-data.js", () => ({ spawnWorkerFromMissionBundle: spawnMissionBundle }));
vi.stubGlobal("window", { maestro: { api } });
vi.stubGlobal("React", React);

function findButton(node: ReactNode, label: string): ReactElement<{ onClick?: () => void | Promise<void> }> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!("type" in node) || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void | Promise<void> }>;
  if (element.type === "button" && element.props.children === label) return element;
  return findButton(element.props.children, label);
}

describe("Planning scope", () => {
  it("passes the connected project id to the server-backed role selection", () => {
    planningMode.value = "overture";
    planningMode.stateCall = 0;
    api.selectOvertureRoles.mockClear();
    const view = Planning({ onNavigate: vi.fn() });
    findButton(view, "Select Overture roles")?.props.onClick?.();
    expect(api.selectOvertureRoles).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      { projectId: "11111111-1111-4111-8111-111111111111", outsideEvidenceRequested: false, previewNeeded: false },
      expect.any(String),
    );
  });

  it("dispatches only the loaded Mission Bundle into the Channel", async () => {
    planningMode.value = "bundle";
    planningMode.stateCall = 0;
    spawnMissionBundle.mockClear();
    const onNavigate = vi.fn();
    const view = Planning({ onNavigate });
    await findButton(view, "Dispatch Worker to Channel")?.props.onClick?.();
    expect(spawnMissionBundle).toHaveBeenCalledWith(
      api,
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ itemId: "hero-section", contentHash: "a".repeat(64) }),
    );
    expect(onNavigate).toHaveBeenCalledWith("channel");
  });
});
