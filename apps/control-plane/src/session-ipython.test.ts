import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolContext } from "@maestro/agent-runtime";
import { createSessionWorkspace } from "./session-workspace.js";
import { createSessionIpPython, createSessionHostRequestHandler } from "./session-ipython.js";
import { createOvertureRoleRuntimePolicy } from "@maestro/domain";

const projectId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const python = "/usr/bin/python3";
const describePython = existsSync(python) ? describe : describe.skip;
const roots: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root() {
  const directory = mkdtempSync(join(tmpdir(), "maestro-session-ipython-"));
  roots.push(directory);
  return directory;
}

function context(index: number): ToolContext {
  return { commandId: `00000000-0000-4000-8000-00000000000${index}`, toolCallId: `call-${index}`, operatorId: "operator-1" } as unknown as ToolContext;
}

function call(code: string) {
  return { id: "call", name: "ipython", arguments: { state: "valid" as const, value: { code } } };
}

describe("session host request handler", () => {
  it("reads, lists, and writes only the bound workspace and rejects other host methods", async () => {
    const workspace = createSessionWorkspace({ root: root() });
    const write = createSessionHostRequestHandler({ workspace, scope: { projectId, conversationId, access: "write" } });
    const read = createSessionHostRequestHandler({ workspace, scope: { projectId, conversationId, access: "read" } });
    const request = (method: string, payload: unknown) => ({ requestId: "r", hostRequestId: "h", method, payload });

    await expect(write(request("write_file", { path: "plan00.md", content: "# Plan" }))).resolves.toMatchObject({ state: "ok" });
    await expect(read(request("read_file", { path: "plan00.md" }))).resolves.toMatchObject({ state: "ok", content: "# Plan" });
    await expect(read(request("list_files", { path: "" }))).resolves.toMatchObject({ content: "plan00.md" });
    await expect(read(request("write_file", { path: "x.md", content: "x" }))).rejects.toThrow("can only read");
    await expect(write(request("run_shell", { argv: ["ls"] }))).rejects.toThrow("not available");
    await expect(write(request("write_file", { path: "../escape.md", content: "x" }))).rejects.toThrow();
  });
});

describePython("session IPython tool", () => {
  it("runs Python with workspace helpers in a persistent kernel", async () => {
    const workspace = createSessionWorkspace({ root: root() });
    const sessions = createSessionIpPython({ workspace, pythonExecutable: python, cwd: tmpdir() });
    cleanups.push(() => sessions.close());
    const writer = sessions.tools({ projectId, conversationId, access: "write" });

    const first = await writer.execute(call('plan = "# Plan\\n\\n- one\\n"\nprint(write_file("plan00.md", plan))'), context(1));
    expect(first.status).toBe("ok");
    expect(first.content).toMatch(/wrote plan00\.md at [0-9a-f]{12}/);
    const second = await writer.execute(call('print(read_file("plan00.md") == plan, list_files().splitlines())'), context(2));
    expect(second.content).toContain("True ['plan00.md']");
    await expect(workspace.read(projectId, conversationId, "plan00.md")).resolves.toMatchObject({ content: "# Plan\n\n- one\n" });

    const reader = sessions.tools({ projectId, conversationId, access: "read" });
    const denied = await reader.execute(call('write_file("x.md", "x")'), context(3));
    expect(denied.status).toBe("error");
    expect(denied.content).toContain("can only read");
  }, 30_000);
});

describe("Overture session tool grant", () => {
  it("gives the conversation lead ipython with workspace guidance", () => {
    const policy = createOvertureRoleRuntimePolicy({ roleId: "conversation-lead", projectId, runId: "run", conversationId });
    expect(policy.allowedTools).toContain("ipython");
    expect(policy.systemPrompt).toContain("write_file(path, content)");
    expect(policy.systemPrompt).toContain("not the project repository");
  });
});
