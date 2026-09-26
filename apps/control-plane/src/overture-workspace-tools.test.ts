import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OVERTURE_WORKSPACE_TOOLS, createOvertureRoleRuntimePolicy } from "@maestro/domain";
import { createSessionWorkspace } from "./session-workspace.js";
import { overtureWorkspaceToolRegistry } from "./overture-workspace-tools.js";
import type { ToolContext } from "@maestro/agent-runtime";

const projectId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const otherConversationId = "33333333-3333-4333-8333-333333333333";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function call(name: string, value: unknown) {
  return { id: `call-${name}`, name, arguments: { state: "valid" as const, value } };
}

const context = {} as ToolContext;

describe("Overture workspace tools", () => {
  it("writes, lists, and reads files only inside the bound conversation workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-overture-tools-"));
    roots.push(root);
    const workspace = createSessionWorkspace({ root });
    const writes: string[] = [];
    const tools = overtureWorkspaceToolRegistry({ workspace, projectId, conversationId, onWrite: (write) => writes.push(write.path) });

    await expect(tools.execute(call("list-workspace-files", {}), context)).resolves.toEqual({ status: "ok", content: "The workspace is empty." });
    const written = await tools.execute(call("write-workspace-file", { path: "plan00.md", content: "# Plan\n", summary: "Draft plan" }), context);
    expect(written.status).toBe("ok");
    expect(written.content).toMatch(/^Wrote plan00\.md at [0-9a-f]{12}\.$/);
    expect(writes).toEqual(["plan00.md"]);
    await expect(tools.execute(call("read-workspace-file", { path: "plan00.md" }), context)).resolves.toEqual({ status: "ok", content: "# Plan\n" });
    await expect(tools.execute(call("list-workspace-files", {}), context)).resolves.toEqual({ status: "ok", content: "plan00.md (7 bytes)" });

    await expect(workspace.list(projectId, otherConversationId)).resolves.toEqual({ files: [], revision: null });
  });

  it("returns tool errors for invalid paths and missing files instead of throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-overture-tools-"));
    roots.push(root);
    const tools = overtureWorkspaceToolRegistry({ workspace: createSessionWorkspace({ root }), projectId, conversationId });
    await expect(tools.execute(call("write-workspace-file", { path: "../escape.md", content: "x" }), context)).resolves.toMatchObject({ status: "error" });
    await expect(tools.execute(call("read-workspace-file", { path: "missing.md" }), context)).resolves.toMatchObject({ status: "error" });
    await expect(tools.execute(call("write-workspace-file", { path: "a.md", content: "x", projectId: "other" }), context)).rejects.toThrow();
  });

  it("is granted to the conversation lead with workspace guidance", () => {
    const policy = createOvertureRoleRuntimePolicy({ roleId: "conversation-lead", projectId, runId: "run", conversationId });
    for (const tool of OVERTURE_WORKSPACE_TOOLS) expect(policy.allowedTools).toContain(tool);
    expect(policy.systemPrompt).toContain("session workspace");
    expect(policy.systemPrompt).toContain("not the project repository");
  });
});
