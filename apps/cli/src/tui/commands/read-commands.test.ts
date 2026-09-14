import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { discoverWorkspaceProject, discoverWorkspaceProjectFromControlPlane, executeReadCommand, readDashboard } from "./read-commands.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";
const councilId = "44444444-4444-4444-8444-444444444444";
const goal = { goalId, projectId, state: "active" as const, version: 2 };

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listGoals: vi.fn().mockResolvedValue({ goals: [goal] }),
    getBudgetSummary: vi.fn().mockResolvedValue({ goalId, projectId, budgetCents: 100, reservedCents: 20, costCents: 10 }),
    listWorkersForGoal: vi.fn().mockResolvedValue({ workers: [{ workerId: "33333333-3333-4333-8333-333333333333", status: "running" }] }),
    ...overrides,
  } as unknown as ApiClient;
}

describe("workspace read commands", () => {
  it("uses the attached workspace session as the project identity without asking for an ID", () => {
    expect(discoverWorkspaceProject("/work/acme", { workspacePath: "/work/acme", projectId })).toEqual({ kind: "attached", projectId });
    expect(discoverWorkspaceProject("/work/acme", undefined)).toEqual({ kind: "unavailable", reason: "No project is attached to this workspace" });
  });

  it("reads authenticated project discovery through the normal read-command path", async () => {
    const api = client({ listProjects: vi.fn().mockResolvedValue({ projects: [projectId] }) });
    await expect(executeReadCommand({ client: api, projectId: "" }, { name: "projects", action: "list", options: {} })).resolves.toEqual({ title: "Projects", lines: [`• ${projectId}`] });
  });

  it("auto-attaches the only project visible to the authenticated operator", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [projectId] });
    await expect(discoverWorkspaceProjectFromControlPlane({ workspacePath: "/work/acme", session: undefined, client: { listProjects } })).resolves.toEqual({ kind: "attached", projectId });
    expect(listProjects).toHaveBeenCalledOnce();
  });

  it("does not guess when project discovery is empty or ambiguous", async () => {
    const empty = await discoverWorkspaceProjectFromControlPlane({ workspacePath: "/work/acme", session: undefined, client: { listProjects: vi.fn().mockResolvedValue({ projects: [] }) } });
    const many = await discoverWorkspaceProjectFromControlPlane({ workspacePath: "/work/acme", session: undefined, client: { listProjects: vi.fn().mockResolvedValue({ projects: [projectId, "44444444-4444-4444-8444-444444444444"] }) } });
    expect(empty).toEqual({ kind: "unavailable", reason: "No projects are available for this operator" });
    expect(many).toEqual({ kind: "unavailable", reason: "Multiple projects are available; choose one with /session attach --project-index=<1-2>" });
  });

  it("keeps an existing workspace attachment when it is still visible", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [projectId] });
    await expect(discoverWorkspaceProjectFromControlPlane({ workspacePath: "/work/acme", session: { workspacePath: "/work/acme", projectId }, client: { listProjects } })).resolves.toEqual({ kind: "attached", projectId });
    expect(listProjects).toHaveBeenCalledOnce();
  });

  it("drops a stale workspace attachment before dashboard reads", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: ["55555555-5555-4555-8555-555555555555"] });
    await expect(discoverWorkspaceProjectFromControlPlane({ workspacePath: "/work/acme", session: { workspacePath: "/work/acme", projectId }, client: { listProjects } })).resolves.toEqual({ kind: "attached", projectId: "55555555-5555-4555-8555-555555555555" });
  });

  it("uses the selected session Goal for a Goal-scoped read when no ID is supplied", async () => {
    const api = client();
    await expect(executeReadCommand({ client: api, projectId, goalId }, { name: "budget", action: "get", options: {} })).resolves.toEqual({ title: "Budget", lines: [`• ${goalId} · spent 10/100 cents · reserved 20`] });
    expect(api.getBudgetSummary).toHaveBeenCalledWith(goalId, { projectId });
  });

  it("reads goals and the selected goal dashboard through the typed client", async () => {
    const result = await readDashboard({ client: client(), projectId });
    expect(result).toEqual({ projectId, goals: [goal], selectedGoal: goal, budget: { goalId, projectId, budgetCents: 100, reservedCents: 20, costCents: 10 }, workerCount: 1 });
  });

  it("selects an active Goal before older draft records and counts only active Workers", async () => {
    const draft = { ...goal, goalId: "44444444-4444-4444-8444-444444444444", state: "draft" as const, version: 1 };
    const workers = [
      { workerId: "33333333-3333-4333-8333-333333333333", status: "running" },
      { workerId: "55555555-5555-4555-8555-555555555555", status: "succeeded" },
      { workerId: "66666666-6666-4666-8666-666666666666", status: "spawned" },
    ];
    const result = await readDashboard({ client: client({ listGoals: vi.fn().mockResolvedValue({ goals: [draft, goal] }), listWorkersForGoal: vi.fn().mockResolvedValue({ workers }) }), projectId });
    expect(result.selectedGoal).toEqual(goal);
    expect(result.workerCount).toBe(2);
  });

  it("routes the remaining typed lifecycle reads instead of reporting them as unavailable", async () => {
    const api = client({
      getTaskContract: vi.fn().mockResolvedValue({ contractId, launchState: "launched", version: 3 }),
      getCouncil: vi.fn().mockResolvedValue({ councilId, state: "resolved" }),
      getDepartmentPlan: vi.fn().mockResolvedValue({ version: 4 }),
      getMissionBundle: vi.fn().mockResolvedValue({ planVersion: 4, contentHash: "hash" }),
    });
    await expect(executeReadCommand({ client: api, projectId }, { name: "task-contract", action: "get", options: { "contract-id": contractId } })).resolves.toEqual({ title: "Task Contract", lines: [`• ${contractId} · launched · v3`] });
    await expect(executeReadCommand({ client: api, projectId }, { name: "council", action: "get", options: { "council-id": councilId } })).resolves.toEqual({ title: "Council", lines: [`• ${councilId} · resolved`] });
    await expect(executeReadCommand({ client: api, projectId }, { name: "department-plan", action: "get", options: { "council-id": councilId, "department-id": "product" } })).resolves.toEqual({ title: "Department Plan", lines: [`• ${councilId}/product · v4`] });
    await expect(executeReadCommand({ client: api, projectId }, { name: "mission-bundle", action: "get", options: { "council-id": councilId, "department-id": "product", "plan-version": "4", "item-id": "item-1" } })).resolves.toEqual({ title: "Mission Bundle", lines: [`• ${councilId}/product/item-1 · v4 · hash`] });
    expect(api.getMissionBundle).toHaveBeenCalledWith(councilId, "product", 4, "item-1", projectId);
  });

  it("rejects an invalid mission bundle plan version before calling the client", async () => {
    const getMissionBundle = vi.fn();
    const api = client({ getMissionBundle });
    await expect(executeReadCommand({ client: api, projectId }, { name: "mission-bundle", action: "get", options: { "council-id": councilId, "department-id": "product", "plan-version": "0", "item-id": "item-1" } })).resolves.toEqual({ title: "Unavailable", lines: ["--plan-version must be a positive integer"] });
    expect(getMissionBundle).not.toHaveBeenCalled();
  });

  it("executes a read command and rejects writes at the read boundary", async () => {
    const api = client();
    await expect(executeReadCommand({ client: api, projectId, goalId }, { name: "goals", action: "list", options: {} })).resolves.toEqual({ title: "Goals", lines: ["• active · v2 · " + goalId] });
    await expect(executeReadCommand({ client: api, projectId, goalId }, { name: "goal", action: "pause", options: {} })).resolves.toEqual({ title: "Unavailable", lines: ["goal pause is a mutation; use the write command path"] });
  });

  it("returns an empty dashboard without inventing a selected goal", async () => {
    const result = await readDashboard({ client: client({ listGoals: vi.fn().mockResolvedValue({ goals: [] }) }), projectId });
    expect(result).toEqual({ projectId, goals: [], selectedGoal: undefined, budget: undefined, workerCount: undefined });
  });
});
