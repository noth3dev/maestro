import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@maestro/api-client";
import { executeCli } from "../../apps/cli/src/main.js";
import { executeReadCommand } from "../../apps/cli/src/tui/commands/read-commands.js";
import { reconcileTuiSession } from "../../apps/cli/src/tui/recovery.js";
import { renderApprovalDialog } from "../../apps/cli/src/tui/components/approval-dialog.js";
import { GoalDepartmentPanels } from "../../apps/carnegie/src/views/panels/GoalDepartmentPanels.js";
import { buildRadialLayout } from "../../apps/carnegie/src/views/panels/radial/radial-layout.js";
import { exposedApiMethods } from "../../apps/carnegie/electron/apiBridge.js";
import type { ProjectionReadModel } from "@maestro/contracts";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const session = { workspacePath: "/work/acme", projectId, goalId, lastEventCursor: "42" };

function projectionWithRecords(): ProjectionReadModel {
  const node = (overrides: Record<string, unknown>) => ({
    nodeId: "node", kind: "worker" as const, projectId, goalId, parentNodeId: null,
    sectorId: "engineering", state: "running", version: 1, ownerId: null,
    crossLinks: [], sourceRevision: "rev-1", eventCursor: "42", removed: false,
    sourceKey: ["node"], ...overrides,
  });
  return {
    eventCursor: "42",
    nodes: [
      node({ nodeId: goalId, kind: "goal", state: "active", sourceKey: [goalId] }),
      node({ nodeId: "goal-2", goalId: "33333333-3333-4333-8333-333333333333", kind: "goal", state: "running", sectorId: "goal", sourceKey: ["goal-2"] }),
      node({ nodeId: "sleeping-department", kind: "department_plan", state: "sleeping", sectorId: "finance" }),
      node({ nodeId: "worker-1", parentNodeId: "sleeping-department", kind: "worker" }),
      node({ nodeId: "approval-1", kind: "capability_approval", state: "below_requirement" }),
    ],
    edges: [],
  };
}

function textFromReactTree(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromReactTree).join(" ");
  if (value !== null && typeof value === "object" && "props" in value) return textFromReactTree((value as { props?: { children?: unknown } }).props?.children);
  return "";
}

describe("Plan 7 §S9 CLI parity and recovery proof (RED)", () => {
  it("compares the UI read error with the equivalent CLI error for the same invalid Goal", async () => {
    const stderr: string[] = [];
    const fetch = vi.fn();
    const exitCode = await executeCli(["goal", "get", "--goal-id", "not-a-uuid", "--project-id", projectId], { MAESTRO_API_URL: "https://maestro.test", MAESTRO_API_TOKEN: "token" }, {
      fetch, stdout: () => undefined, stderr: (line) => stderr.push(line),
    });
    let uiError = "";
    try {
      await executeReadCommand({ client: createApiClient({ baseUrl: "https://maestro.test", token: "token", fetch }), projectId }, { name: "goal", action: "get", options: { "goal-id": "not-a-uuid" } });
    } catch (error) {
      uiError = error instanceof Error ? error.message : String(error);
    }
    expect(exitCode).toBe(2);
    expect(stderr[0]?.trim()).toBe(uiError);
  });

  it("reopens an in-flight Goal with its worker and pending approval identities", () => {
    const recovered = reconcileTuiSession("/work/acme", session, {
      goalState: "recovering", activeWorkers: 1,
      workerIds: ["worker-1"], pendingApprovalIds: ["approval-1"],
    } as never);
    expect(recovered).toMatchObject({ kind: "stale", goalId, workerIds: ["worker-1"], pendingApprovalIds: ["approval-1"] });
  });

  it("renders multiple Goals, a sleeping Department, Metronome, Encore, and Discord together", () => {
    const projection = projectionWithRecords();
    expect(buildRadialLayout(projection, { selectedGoalId: goalId }).nodes.filter((node) => node.kind === "goal")).toHaveLength(2);
    const element = GoalDepartmentPanels({ projection, events: [], certifications: [] });
    const text = textFromReactTree(element);
    expect(text).toContain("Metronome");
    expect(text).toContain("Encore");
    expect(text).toContain("Discord");
    expect(text).toContain("sleeping");
  });

  it("retains durable source revision and event cursor on graph nodes after restart", () => {
    const projection = projectionWithRecords();
    const goal = buildRadialLayout(projection, { selectedGoalId: goalId }).nodes.find((node) => node.id === goalId);
    expect(goal).toMatchObject({ sourceRevision: "rev-1", eventCursor: "42" });
  });

  it("shows pinned-model B/C or A↔D pressure escalation instead of silently running", () => {
    const lines = renderApprovalDialog({
      action: "run", target: "worker-1", effect: "allow", expiresAt: "2030-01-01T00:00:00.000Z",
      identity: "approval-1", actor: "head:engineering", tier: "Encore Council",
      effects: [], repetitionScope: "once", saferAlternative: "pause",
      pressure: 180, pressureBand: "critical", pressureTier: "user", tierTrigger: "pressure",
      pinnedModel: "provider/model-pinned", routingFailure: "B/C and A↔D requirement failure",
    } as never, 120);
    expect(lines.join("\n")).toContain("Pinned model");
    expect(lines.join("\n")).toContain("B/C and A↔D requirement failure");
  });

  it("keeps routing-off and below-requirement markers through projection and certification views", () => {
    const element = GoalDepartmentPanels({ projection: projectionWithRecords(), events: [], certifications: [], goalId });
    const text = textFromReactTree(element);
    expect(text).toContain("routing-off");
    expect(text).toContain("below-requirement");
  });

  it("reruns the remaining phase tests through one complete CLI/UI bridge surface", () => {
    expect(exposedApiMethods).toEqual(expect.arrayContaining([
      "createConversation", "getConversation", "sendConversationTurn", "cancelConversation",
    ]));
  });
});
