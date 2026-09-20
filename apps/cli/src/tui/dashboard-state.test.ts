import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "./commands/read-commands.js";
import { dashboardErrorState, dashboardStateFromReadModel, selectedCommandGoalId, selectedConversationGoalId } from "./dashboard-state.js";

describe("dashboard state mapping", () => {
  it("maps a selected dashboard read model into TUI async states", () => {
    const dashboard = {
      projectId: "project-1",
      goals: [],
      selectedGoal: { goalId: "goal-1", state: "running" },
      budget: { goalId: "goal-1", projectId: "project-1", budgetCents: 500, reservedCents: 100, costCents: 25 },
      workerCount: 2,
    } satisfies DashboardReadModel;

    expect(dashboardStateFromReadModel(dashboard)).toEqual({
      goal: { kind: "value", value: { goalId: "goal-1", name: "goal-1", state: "running" } },
      workers: { kind: "value", value: 2 },
      budget: { kind: "value", value: { spentCents: 25, ceilingCents: 500 } },
    });
  });

  it("uses an explicit session Goal before the ephemeral dashboard selection", () => {
    const selected = { kind: "value", value: { goalId: "goal-1", name: "goal-1", state: "active" } } as const;
    expect(selectedConversationGoalId(selected, "saved-goal")).toBe("saved-goal");
    expect(selectedConversationGoalId(selected, undefined)).toBe("goal-1");
    expect(selectedConversationGoalId({ kind: "empty" }, undefined)).toBeUndefined();
  });

  it("keeps explicit command Goal options ahead of session and dashboard state", () => {
    const selected = { kind: "value", value: { goalId: "dashboard-goal", name: "dashboard-goal", state: "active" } } as const;
    expect(selectedCommandGoalId("explicit-goal", selected, "saved-goal")).toBe("explicit-goal");
    expect(selectedCommandGoalId("  ", selected, "saved-goal")).toBe("saved-goal");
    expect(selectedCommandGoalId(true, selected, undefined)).toBe("dashboard-goal");
    expect(selectedCommandGoalId(undefined, { kind: "empty" }, undefined)).toBeUndefined();
  });

  it("maps an empty or failed dashboard read without inventing values", () => {
    const empty = {
      projectId: "project-1",
      goals: [],
      selectedGoal: undefined,
      budget: undefined,
      workerCount: undefined,
    } satisfies DashboardReadModel;
    expect(dashboardStateFromReadModel(empty)).toEqual({
      goal: { kind: "empty" },
      workers: { kind: "empty" },
      budget: { kind: "empty" },
    });
    expect(dashboardErrorState("Control Plane read failed")).toEqual({
      goal: { kind: "error", message: "Control Plane read failed" },
      workers: { kind: "error", message: "Control Plane read failed" },
      budget: { kind: "error", message: "Control Plane read failed" },
    });
  });
});
