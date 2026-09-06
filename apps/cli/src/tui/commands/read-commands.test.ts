import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { discoverWorkspaceProject, executeReadCommand, readDashboard } from "./read-commands.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
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
