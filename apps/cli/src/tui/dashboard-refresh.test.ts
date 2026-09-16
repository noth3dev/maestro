import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "./commands/read-commands.js";
import { refreshDashboardState } from "./dashboard-refresh.js";

const dashboard = {
  projectId: "project-1",
  goals: [],
  selectedGoal: undefined,
  budget: undefined,
  workerCount: undefined,
} as DashboardReadModel;

describe("dashboard refresh orchestration", () => {
  it("loads and renders the loading and ready states in order", async () => {
    const order: string[] = [];
    await refreshDashboardState({
      client: {} as never,
      projectId: "project-1",
      goalId: "goal-1",
      readDashboard: async (input) => {
        expect(input).toEqual({ client: {}, projectId: "project-1", goalId: "goal-1" });
        order.push("read");
        return dashboard;
      },
      setDashboardState: (state) => order.push(state.goal.kind === "loading" ? "loading" : "apply"),
      setRecovery: () => order.push("recovery"),
      render: () => order.push("render"),
    });
    expect(order).toEqual(["loading", "render", "read", "apply", "recovery", "render"]);
  });

  it("applies a normalized error state and renders when reading fails", async () => {
    const order: string[] = [];
    await refreshDashboardState({
      client: {} as never,
      projectId: "project-1",
      readDashboard: async () => {
        throw new Error("offline");
      },
      setDashboardState: (state) => order.push(state.goal.kind === "error" ? `error:${state.goal.message}` : "loading"),
      setRecovery: () => order.push("recovery"),
      render: () => order.push("render"),
    });
    expect(order).toEqual(["loading", "render", "error:offline", "render"]);
  });

  it("ignores a stale dashboard success after a newer refresh starts", async () => {
    const oldDashboard = { ...dashboard, projectId: "old-project" };
    const newDashboard = { ...dashboard, projectId: "new-project" };
    const events: string[] = [];
    let resolveOld!: (value: DashboardReadModel) => void;
    let generation = 1;
    const oldRefresh = refreshDashboardState({
      client: {} as never,
      projectId: "old-project",
      readDashboard: () => new Promise((resolve) => { resolveOld = resolve; }),
      isCurrent: () => generation === 1,
      setDashboardState: (state) => events.push(state.goal.kind === "loading" ? "loading" : `state:${state.goal.kind}`),
      setRecovery: (value) => events.push(`recovery:${value.projectId}`),
      render: () => events.push("render"),
    });

    generation = 2;
    await refreshDashboardState({
      client: {} as never,
      projectId: "new-project",
      readDashboard: async () => newDashboard,
      isCurrent: () => generation === 2,
      setDashboardState: (state) => events.push(state.goal.kind === "loading" ? "loading" : `state:${state.goal.kind}`),
      setRecovery: (value) => events.push(`recovery:${value.projectId}`),
      render: () => events.push("render"),
    });
    resolveOld(oldDashboard);
    await oldRefresh;

    expect(events).toEqual(["loading", "render", "loading", "render", "state:empty", "recovery:new-project", "render"]);
  });

  it("ignores a stale dashboard failure after a newer refresh starts", async () => {
    const events: string[] = [];
    let rejectOld!: (reason?: unknown) => void;
    let generation = 1;
    const oldRefresh = refreshDashboardState({
      client: {} as never,
      projectId: "old-project",
      readDashboard: () => new Promise<DashboardReadModel>((_, reject) => { rejectOld = reject; }),
      isCurrent: () => generation === 1,
      setDashboardState: (state) => events.push(state.goal.kind === "loading" ? "loading" : `state:${state.goal.kind}`),
      setRecovery: () => events.push("recovery"),
      render: () => events.push("render"),
    });

    generation = 2;
    rejectOld(new Error("old project offline"));
    await oldRefresh;

    expect(events).toEqual(["loading", "render"]);
  });
});
