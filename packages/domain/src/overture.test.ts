import { describe, expect, it } from "vitest";
import {
  OVERTURE_ROLE_IDS,
  OVERTURE_ROLE_DEFINITIONS,
  assertValidOverturePlanPath,
  buildOverturePlanManifest,
  overturePlanContentHash,
  isSafeOvertureText,
  createOvertureRoleRuntimePolicy,
  type OverturePlanDocument,
} from "./overture.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

function document(path: string, kind: OverturePlanDocument["kind"], content = `# ${path}`): OverturePlanDocument {
  return {
    documentId: path,
    projectId,
    runId,
    path,
    kind,
    version: 1,
    content,
    contentHash: overturePlanContentHash(content),
    sourceRefs: [],
    dependencies: kind === "slice" ? ["plan01.md"] : [],
  };
}

describe("Overture domain foundation", () => {
  it("defines the complete deterministic seven-role Crew taxonomy", () => {
    expect(OVERTURE_ROLE_IDS).toEqual([
      "conversation-lead",
      "architecture-analyst",
      "external-research-scout",
      "security-evaluator",
      "design-mock-specialist",
      "task-editor",
      "plan-reviewer",
    ]);
    expect(OVERTURE_ROLE_DEFINITIONS.map((role) => role.id)).toEqual(OVERTURE_ROLE_IDS);
    expect(OVERTURE_ROLE_DEFINITIONS.every((role) => role.modelCapabilityAxes.length > 0)).toBe(true);
  });

  it("accepts only the plan00, phase, and phase-slice grammar", () => {
    expect(assertValidOverturePlanPath("plan00.md", "project")).toBe("plan00.md");
    expect(assertValidOverturePlanPath("plan01.md", "phase")).toBe("plan01.md");
    expect(assertValidOverturePlanPath("plan01-slice02.md", "slice")).toBe("plan01-slice02.md");
    expect(() => assertValidOverturePlanPath("plan1.md", "phase")).toThrow("plan path");
    expect(() => assertValidOverturePlanPath("plan00.md", "phase")).toThrow("kind");
    expect(() => assertValidOverturePlanPath("plan01-slice00.md", "slice")).toThrow("slice");
  });

  it("creates a stable hash-bound manifest and rejects tampering", () => {
    const root = document("plan00.md", "project");
    const phase = document("plan01.md", "phase");
    const slice = { ...document("plan01-slice02.md", "slice"), dependencies: [phase.documentId] };
    const docs = [slice, root, phase];
    const manifest = buildOverturePlanManifest({ projectId, runId, documents: docs });
    expect(manifest.documents.map((item) => item.path)).toEqual(["plan00.md", "plan01.md", "plan01-slice02.md"]);
    expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildOverturePlanManifest({ projectId, runId, documents: [...docs].reverse() })).toEqual(manifest);
    expect(() =>
      buildOverturePlanManifest({ projectId, runId, documents: [document("plan00.md", "project", "tampered"), ...docs.slice(1)] }),
    ).toThrow("duplicate");
  });

  it("builds distinct bounded role policies with one project/run/conversation boundary", () => {
    const policies = OVERTURE_ROLE_IDS.map((roleId) =>
      createOvertureRoleRuntimePolicy({ roleId, projectId, runId, conversationId: "33333333-3333-4333-8333-333333333333" }),
    );
    expect(new Set(policies.map((policy) => policy.systemPrompt)).size).toBe(OVERTURE_ROLE_IDS.length);
    expect(policies.every((policy) => policy.contextBoundary.projectId === projectId && policy.contextBoundary.runId === runId)).toBe(true);
    expect(policies.every((policy) => policy.outputTokenBudget > 0 && policy.systemPrompt.includes("never return private reasoning"))).toBe(
      true,
    );
    expect(() =>
      createOvertureRoleRuntimePolicy({
        roleId: "not-a-role" as never,
        projectId,
        runId,
        conversationId: "33333333-3333-4333-8333-333333333333",
      }),
    ).toThrow("unknown Overture role");
  });

  it("requires every slice to name its phase dependency and rejects provider/raw output", () => {
    const root = document("plan00.md", "project");
    const phase = document("plan01.md", "phase");
    expect(() =>
      buildOverturePlanManifest({
        projectId,
        runId,
        documents: [root, phase, { ...document("plan01-slice01.md", "slice"), dependencies: [] }],
      }),
    ).toThrow("depend");
    expect(isSafeOvertureText("ghp_123456789012345678901234567890")).toBe(false);
    expect(isSafeOvertureText('<tool_call>{"secret":true}</tool_call>')).toBe(false);
  });

  it("keeps the pre-launch authority boundary goal-less", () => {
    const role = OVERTURE_ROLE_DEFINITIONS.find((item) => item.id === "task-editor")!;
    expect(role.forbiddenActions).toEqual(expect.arrayContaining(["create-goal", "spawn-worker", "launch-task-contract"]));
  });
});
