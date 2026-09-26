import { describe, expect, it } from "vitest";
import type { GoalPlan } from "@maestro/contracts";
import { buildKanbanBoard, departmentLabel, planSummary } from "./kanban-data.js";

const slice = (sliceId: string, departmentId: string, status: GoalPlan["slices"][number]["status"], dependsOn: string[] = []) => ({
  sliceId, phaseNo: Number(sliceId.slice(1, sliceId.indexOf("s"))), departmentId, title: sliceId, objective: "o", acceptance: ["a"], dependsOn, status, statusReason: null,
});

const plan = (status: GoalPlan["status"], slices: GoalPlan["slices"]): GoalPlan => ({
  goalId: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", version: 2, status, councilId: null,
  contentHash: "a".repeat(64), approvalRef: null, phases: [{ phaseNo: 1, title: "Build", outcome: "Works" }, { phaseNo: 2, title: "Ship", outcome: "Live" }],
  slices, createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
});

describe("kanban board", () => {
  it("groups slices into sorted department lanes and status columns", () => {
    const board = buildKanbanBoard(plan("approved", [
      slice("p1s1", "engineering", "done"),
      slice("p1s2", "design", "review"),
      slice("p1s3", "engineering", "in_progress", ["p1s1", "p1s2"]),
      slice("p2s1", "engineering", "approved", ["p1s3"]),
    ]));
    expect(board.lanes.map((lane) => lane.departmentId)).toEqual(["design", "engineering"]);
    const engineering = board.lanes[1]!;
    expect(engineering).toMatchObject({ total: 3, done: 1 });
    expect(engineering.cells.in_progress[0]).toMatchObject({ column: "in_progress", blocked: false, waitingOn: ["p1s2"] });
    expect(board.totals).toEqual({ planned: 0, approved: 1, in_progress: 1, review: 1, done: 1 });
  });

  it("keeps blocked cards on the board with a marker", () => {
    expect(buildKanbanBoard(plan("draft", [slice("p1s1", "security", "blocked")])).lanes[0]!.cells.planned[0]).toMatchObject({ blocked: true });
    const approved = buildKanbanBoard(plan("approved", [slice("p1s1", "security", "blocked")]));
    expect(approved.lanes[0]!.cells.in_progress[0]).toMatchObject({ blocked: true });
    expect(approved.blocked).toBe(1);
  });

  it("labels departments and summarizes the plan", () => {
    expect(departmentLabel("quality-assurance")).toBe("Quality Assurance");
    expect(planSummary(plan("draft", [slice("p1s1", "design", "done"), slice("p1s2", "design", "planned")]))).toBe("awaiting Encore approval · v2 · 1/2 done");
    expect(planSummary(plan("awaiting_approval", []))).toBe("needs your decision · v2 · 0/0 done");
  });
});
