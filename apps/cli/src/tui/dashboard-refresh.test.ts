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
});
