import type { DepartmentPlan } from "@maestro/contracts";
import { panelLine, type PanelState } from "./common.js";

export function renderDepartmentPlanPanel(state: PanelState<DepartmentPlan>, width: number): string[] {
  if (state.kind === "loading") return ["Department Plan", "Loading Department Plan…"];
  if (state.kind === "error") return ["Department Plan", panelLine(`Unable to read Department Plan: ${state.message}`, width)];
  if (state.kind === "empty") return ["Department Plan", "No Department Plan data."];
  const plan = state.value;
  const substance = plan.substance;
  const lines = [
    `• ${plan.councilId}/${plan.departmentId} · v${plan.version}`,
    `project: ${plan.projectId} · goal: ${plan.goalId}`,
    `head role: ${plan.headRoleId}`,
    `council snapshot hash: ${plan.councilSnapshotHash}`,
    `decision packet hash: ${plan.decisionPacketHash}`,
    `contract: ${plan.contractId} v${plan.contractVersion} · hash ${plan.contractContentHash}`,
    `content hash: ${plan.contentHash}`,
    `contribution: ${substance.contribution}`,
    `non-goals: ${substance.nonGoals.join(", ")}`,
  ];
  for (const item of substance.items) {
    lines.push(`item ${item.itemId}: ${item.kind} · objective: ${item.objective}`);
    lines.push(`  depends on: ${item.dependsOn.join(", ") || "none"}`);
    lines.push(`  scout question: ${item.scoutQuestion || "none"}`);
    lines.push(`  worker assignment: ${item.workerAssignment || "none"}`);
    lines.push(`  item evidence: ${item.evidenceReferences.join(", ") || "none"}`);
  }
  lines.push(
    `required handoffs: ${substance.requiredHandoffs.join(", ")}`,
    `budget ceiling: ${substance.budgetCeiling}`,
    `expected time: ${substance.expectedTime}`,
    `max retries: ${substance.maxRetries}`,
    `max workers: ${substance.maxWorkers}`,
    `git: ${substance.gitRepository} · ${substance.gitBranch} · integration ${substance.integrationPath}`,
    `risks: ${substance.risks.join(", ")}`,
    `safe pause points: ${substance.safePausePoints.join(", ")}`,
    `escalation triggers: ${substance.escalationTriggers.join(", ")}`,
    `plan evidence: ${substance.evidenceReferences.join(", ")}`,
    `validation: ${substance.validationCriteria.join(", ")}`,
    "Revision history unavailable from Department Plan route response.",
  );
  return ["Department Plan", ...lines.map((line) => panelLine(line, width))];
}
