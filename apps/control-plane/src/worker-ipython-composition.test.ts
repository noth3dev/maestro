import { describe, expect, it } from "vitest";
import type { EnvironmentRecord } from "@maestro/domain";
import { resolveWorkerIpPythonComposition } from "./main.js";

const environment: EnvironmentRecord = {
  environmentId: "environment-1", recipeVersion: 1, goalId: "goal-1", departmentId: "product", workerId: "worker-1", projectId: "project-1", missionId: "mission-1", type: "local_worktree",
  recipe: {}, resolvedInputs: {}, capabilities: [{ name: "node", version: "24" }], secretsReferences: [],
  boundaries: { network: ["none"], filesystem: ["/worktrees/worker-1"], processes: ["node"], browsers: [], devices: [] },
  resources: { cpuMillis: 1000, memoryMb: 128, diskMb: 256, processCount: 2, durationSeconds: 60 },
  expiresAt: "2099-01-01T00:00:00.000Z", state: "ready", setupLog: [], health: { status: "healthy", checkedAt: null, summary: null }, contentIdentity: "a".repeat(64),
  cleanup: { status: "not_scheduled", scheduledAt: null, completedAt: null, ownedResources: [], retainedEvidence: [] },
};

describe("worker IPython composition", () => {
  it("binds the worker worktree, ready environment, and fencing owner from durable state", async () => {
    const queries = [
      { rowCount: 1, rows: [{ worker_id: "worker-1", council_id: "council-1", department_id: "product", plan_version: 1, item_id: "item-1", goal_id: "goal-1", project_id: "project-1", owner_id: "owner-1", owner_fencing_token: "42", substance: { environment: ["environment-1"], allowedTools: ["ipython"], authorityBoundary: ["local"] } }] },
      { rowCount: 1, rows: [{ worktree_path: "/worktrees/worker-1" }] },
      { rowCount: 1, rows: [{ environment_id: environment.environmentId, recipe_version: environment.recipeVersion, goal_id: environment.goalId, department_id: environment.departmentId, worker_id: environment.workerId, project_id: environment.projectId, mission_id: environment.missionId, environment_type: environment.type, recipe: environment.recipe, resolved_inputs: environment.resolvedInputs, capabilities: environment.capabilities, boundaries: environment.boundaries, secrets_references: environment.secretsReferences, resource_ceilings: environment.resources, expires_at: environment.expiresAt, state: environment.state, setup_log: environment.setupLog, health: environment.health, content_identity: environment.contentIdentity, cleanup: environment.cleanup }] },
    ];
    const pool = { query: async () => queries.shift() ?? { rows: [] } };

    await expect(resolveWorkerIpPythonComposition(pool, { commandId: "command-1", projectId: "project-1", goalId: "goal-1" })).resolves.toEqual({
      workerId: "worker-1", workspaceRoot: "/worktrees/worker-1", fencingToken: "42", ownerId: "owner-1", allowedTools: ["ipython"], authorityBoundary: ["local"], environment,
    });
  });


  it("does not bind a global root when the durable worker worktree is missing", async () => {
    const queries = [
      { rows: [{ worker_id: "worker-1", goal_id: "goal-1", project_id: "project-1", owner_id: "owner-1", owner_fencing_token: "42", substance: { allowedTools: ["ipython"], authorityBoundary: ["read-only"] } }] },
      { rows: [] },
    ];
    const pool = { query: async () => queries.shift() ?? { rows: [] } };
    const result = await resolveWorkerIpPythonComposition(pool, { commandId: "command-1", projectId: "project-1", goalId: "goal-1" });
    expect(result).toMatchObject({ workerId: "worker-1" });
    expect(result).not.toHaveProperty("workspaceRoot");
  });

  it("rejects a durable worktree outside the trusted worker root", async () => {
    const queries = [
      { rows: [{ worker_id: "worker-1", goal_id: "goal-1", project_id: "project-1", owner_id: "owner-1", owner_fencing_token: "42", substance: { allowedTools: ["ipython"], authorityBoundary: ["read-only"] } }] },
      { rows: [{ worktree_path: "/etc" }] },
    ];
    const pool = { query: async () => queries.shift() ?? { rows: [] } };
    const result = await resolveWorkerIpPythonComposition(pool, { commandId: "command-1", projectId: "project-1", goalId: "goal-1", trustedWorktreeRoot: "/tmp" });
    expect(result).not.toHaveProperty("workspaceRoot");
    expect(result).toMatchObject({ workspaceBindingValid: false });
  });

  it("fails closed when a worker declares more than one environment", async () => {
    const queries = [
      { rows: [{ worker_id: "worker-1", goal_id: "goal-1", project_id: "project-1", owner_id: "owner-1", owner_fencing_token: "42", substance: { environment: ["environment-1", "environment-2"], allowedTools: ["ipython"], authorityBoundary: ["local"] } }] },
      { rows: [{ worktree_path: "/worktrees/worker-1" }] },
    ];
    const pool = { query: async () => queries.shift() ?? { rows: [] } };
    const result = await resolveWorkerIpPythonComposition(pool, { commandId: "command-1", projectId: "project-1", goalId: "goal-1" });
    expect(result).toMatchObject({ workerId: "worker-1", environmentBindingValid: false });
    expect(result).not.toHaveProperty("environment");
  });

  it("fails closed when the command is not a persisted worker admission", async () => {
    const pool = { query: async () => ({ rows: [] }) };
    await expect(resolveWorkerIpPythonComposition(pool, { commandId: "conversation-1", projectId: "project-1", goalId: "goal-1" })).resolves.toEqual({});
  });
});
