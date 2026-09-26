import { createRoot } from "react-dom/client";
import type { GoalPlan } from "@maestro/contracts";
import "../styles/theme.css";
import "../styles/components.css";
import { KanbanBoardView } from "./Kanban.js";

const slice = (sliceId: string, departmentId: string, status: GoalPlan["slices"][number]["status"], dependsOn: string[] = [], statusReason: string | null = null) => ({
  sliceId, phaseNo: Number(sliceId.slice(1, sliceId.indexOf("s"))), departmentId, title: `Slice ${sliceId}`, objective: `Objective for ${sliceId}`,
  acceptance: [`${sliceId} is verified`], dependsOn, status, statusReason,
});

/** Fixture plan for the accessibility smoke test (served by Vite, never bundled into the app). */
const plan: GoalPlan = {
  goalId: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", version: 1, status: "approved", councilId: null,
  contentHash: "a".repeat(64), approvalRef: "encore-round-1",
  phases: [{ phaseNo: 1, title: "Sign-up page", outcome: "Visitors can subscribe" }, { phaseNo: 2, title: "Launch", outcome: "Page is live" }],
  slices: [
    slice("p1s1", "design", "done"),
    slice("p1s2", "engineering", "in_progress", ["p1s1"]),
    slice("p1s3", "security", "blocked", [], "Waiting for a secrets policy decision"),
    slice("p1s4", "engineering", "review", ["p1s1"]),
    slice("p2s1", "infrastructure", "approved", ["p1s2", "p1s4"]),
  ],
  createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
};

createRoot(document.getElementById("root")!).render(
  <main aria-labelledby="kanban-page-title">
    <h1 id="kanban-page-title" className="sr-only">Slice board</h1>
    <KanbanBoardView plan={plan} />
  </main>,
);
