import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@maestro/api-client";
import { MODEL_CAPABILITY_AXES, MODEL_CAPABILITY_SCHEMA_VERSION, MODEL_MAP_SCHEMA_VERSION, TASK_DEMAND_SCHEMA_VERSION, RoutingSelectionError, selectRoutedModel, snapshotOperationalOverlayForGoal, type ModelCapabilityVector, type ModelMap, type RoutingSelectionRequest, type TaskDemand } from "@maestro/domain";
import { executeCli } from "../../apps/cli/src/main.js";
import { executeReadCommand } from "../../apps/cli/src/tui/commands/read-commands.js";
import { reconcileTuiSession } from "../../apps/cli/src/tui/recovery.js";
import { GoalDepartmentPanels } from "../../apps/carnegie/src/views/panels/GoalDepartmentPanels.js";
import { buildRadialLayout } from "../../apps/carnegie/src/views/panels/radial/radial-layout.js";
import type { Certification, ProjectionReadModel } from "@maestro/contracts";

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
      node({ nodeId: "approval-1", kind: "capability_approval", state: "below_requirement", sectorId: "engineering" }),
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

  it("preserves the currently typed restart recovery state without claiming worker or approval detail", () => {
    const recovered = reconcileTuiSession("/work/acme", session, { goalState: "recovering", activeWorkers: 1 });
    expect(recovered).toMatchObject({ kind: "stale", goalId, projectId, goalState: "recovering", activeWorkers: 1 });
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

  it("uses the restart recovery seam before rebuilding graph identity", () => {
    const recovered = reconcileTuiSession("/work/acme", session, { goalState: "recovering", activeWorkers: 1 });
    expect(recovered.kind).toBe("stale");
    const projection = projectionWithRecords();
    const goal = buildRadialLayout(projection, { selectedGoalId: goalId }).nodes.find((node) => node.id === goalId);
    expect(goal).toMatchObject({ id: goalId, sourceKey: [goalId] });
    expect(goal).toHaveProperty("sourceRevision", "rev-1");
    expect(goal).toHaveProperty("eventCursor", "42");
  });

  it("fails closed for a pinned model that fails typed B/C and A↔D requirements", () => {
    const capability = (score: number): ModelCapabilityVector => ({
      schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION,
      axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score, rationale: "reviewed", evidence: ["evidence-1"] }])) as ModelCapabilityVector["axes"],
    });
    const taskDemand: TaskDemand = {
      schemaVersion: TASK_DEMAND_SCHEMA_VERSION, taskKinds: ["coding"],
      requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: axis === "coding" ? 80 : 1, rationale: "Head requirement" }])) as TaskDemand["requirements"],
      provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" },
    };
    const modelMap: ModelMap = {
      schemaVersion: MODEL_MAP_SCHEMA_VERSION,
      entries: [{ modelRef: "provider/pinned", capability: capability(50), providerFacts: {
        schemaVersion: 1, contextCapacity: 128_000, pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["public"], retention: "transient", trainingUse: "never", regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "review", observedAt: "2026-09-15" },
      }, provenance: { owner: "human", sourceRefs: ["review"], reviewedAt: "2026-09-15" } }],
    };
    const overlay = snapshotOperationalOverlayForGoal({ schemaVersion: 1, installationRef: "install-1", projectRef: projectId, version: 1, observations: [{ candidateRef: "pinned", measuredLatencyMs: 1, measuredCost: 1, failureRate: 0, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-15T00:00:00.000Z" }] }, goalId);
    const request: RoutingSelectionRequest = { mode: "pin", goalRef: goalId, approvedModels: ["provider/pinned"], pinModelRef: "provider/pinned", taskDemand, modelMap, operationalOverlay: overlay, candidates: [{ candidateRef: "pinned", modelRef: "provider/pinned", accountBinding: "account-1" }], pressure: 180, requiredRegion: "eu" };
    let failure: RoutingSelectionError | undefined;
    try { selectRoutedModel(request); } catch (error) { if (error instanceof RoutingSelectionError) failure = error; else throw error; }
    expect(failure).toBeInstanceOf(RoutingSelectionError);
    expect(failure?.rejected.map((item) => item.reason)).toEqual(expect.arrayContaining(["provider data policy does not cover the required region"]));
  });

  it("keeps routing-off and below-requirement markers through projection and certification views", () => {
    const certification: Certification = {
      certificationId: "44444444-4444-4444-8444-444444444444", kind: "quality", goalId,
      contractId: "55555555-5555-4555-8555-555555555555", contractVersion: 1, contractContentHash: "a".repeat(64),
      integratedCommitSha: "a".repeat(40), workerId: "66666666-6666-4666-8666-666666666666",
      departmentAcceptanceId: "77777777-7777-4777-8777-777777777777", integrationRevisionId: "88888888-8888-4888-8888-888888888888",
      verdict: "passed", certifiedByDepartment: "quality", producingDepartment: "engineering",
    };
    const element = GoalDepartmentPanels({
      projection: projectionWithRecords(), events: [], certifications: [certification], goalId,
      evidenceBundle: { bundleId: "99999999-9999-4999-8999-999999999999", goalId, content: { routingEvidence: [] }, hash: "b".repeat(64) },
    });
    const text = textFromReactTree(element);
    expect(text).toContain("routing-off");
    expect(text).toContain("below-requirement");
  });

  it("runs an existing Goal read through both the CLI entrypoint and the typed UI read path", async () => {
    const goal = { goalId, projectId, state: "active", version: 2 };
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ goals: [goal] }), { status: 200 })));
    const stdout: string[] = [];
    expect(await executeCli(["goals", "list", "--project-id", projectId, "--json"], { MAESTRO_API_URL: "https://maestro.test", MAESTRO_API_TOKEN: "token" }, { fetch, stdout: (line) => stdout.push(line), stderr: () => undefined })).toBe(0);
    const ui = await executeReadCommand({ client: createApiClient({ baseUrl: "https://maestro.test", token: "token", fetch }), projectId }, { name: "goals", action: "list", options: {} });
    expect(JSON.parse(stdout[0]!).goals).toEqual([goal]);
    expect(ui.lines).toContain(`• active · v2 · ${goalId}`);
  });
});
