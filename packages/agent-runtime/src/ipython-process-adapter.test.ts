import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createIpPythonOwnedProcessChannel, createIpPythonTwoStageProcessKernel, reapIpPythonProcessGroup } from "./ipython-process-adapter.js";
import { IPYTHON_PYTHON_BOOTSTRAP } from "./ipython-bootstrap.js";
import { createIpPythonProcessKernel } from "./ipython-host.js";

class FakeChild {
  readonly stdin = { write: vi.fn(() => true), end: vi.fn() };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "close") this.closeListener = listener;
    if (event === "error") this.errorListener = listener;
    if (event === "exit") this.exitListener = listener;
    return this;
  });
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => { this.closeListener?.(null, "SIGKILL"); return true; });
  readonly pid = 4321;
  closeListener?: (...args: unknown[]) => void;
  errorListener?: (...args: unknown[]) => void;
  exitListener?: (...args: unknown[]) => void;
}

describe("IPython owned process channel", () => {
  it("spawns a detached constrained Python process with a minimal environment", () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
    createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", parentPid: 1234, parentIdentity: "parent-start-1", spawnProcess });

    expect(spawnProcess).toHaveBeenCalledWith("/usr/bin/python3", ["-I", "-S", "-c", expect.stringContaining("ready")], expect.objectContaining({ detached: true, stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", LANG: "C.UTF-8", MAESTRO_PARENT_PID: "1234", MAESTRO_PARENT_IDENTITY: "parent-start-1", MAESTRO_OWNED_PROCESS_GROUP: "1" } }));
  });

  it("forwards stdout and keeps bounded stderr diagnostics separate", () => {
    const child = new FakeChild();
    const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams });
    const stdout: Buffer[] = [];
    const stderr: string[] = [];
    channel.onData((chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    channel.onStderr?.((text) => stderr.push(text));
    child.stdout.emit("data", Buffer.from("protocol\n"));
    child.stderr.emit("data", Buffer.from("diagnostic\n"));

    expect(Buffer.concat(stdout).toString()).toBe("protocol\n");
    expect(stderr).toEqual(["diagnostic\n"]);
  });


  it("consumes a child launch error before rejecting unavailable process handles", () => {
    const child = new FakeChild();
    Object.defineProperty(child, "pid", { value: undefined });
    expect(() => createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams })).toThrow("process handles");
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(() => child.errorListener?.(new Error("launch failed"))).not.toThrow();
  });

  it("keeps stderr below the configured hard cap even for split UTF-8 bytes", () => {
    const child = new FakeChild();
    const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", maxStderrBytes: 1, spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams });
    const stderr: string[] = [];
    channel.onStderr((text) => stderr.push(text));
    child.stderr.emit("data", Buffer.from("é"));
    expect(Buffer.byteLength(stderr.join(""), "utf8")).toBeLessThanOrEqual(1);
    expect(stderr).toEqual([]);
    expect(() => createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", maxStderrBytes: 1_048_577, spawnProcess: () => new FakeChild() as unknown as ChildProcessWithoutNullStreams })).toThrow("stderr limit");
  });

  it("waits for durable process-start evidence before sending a cell", async () => {
    const child = new FakeChild();
    let releaseStart!: () => void;
    const startCompleted = new Promise<void>((resolve) => { releaseStart = resolve; });
    const channel = createIpPythonOwnedProcessChannel({
      pythonExecutable: "/usr/bin/python3",
      onStarted: async () => { await startCompleted; },
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const kernel = createIpPythonProcessKernel({ createProcess: () => channel, hostRequest: async () => ({ state: "error", dataClass: "workspace", content: "unused" }) }, "session-start-gate");
    const pending = kernel.execute({ sessionId: "session-start-gate", code: "print('gated')" });
    child.stdout.emit("data", Buffer.from('{"version":1,"type":"ready","runtime":"python"}\n'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.stdin.write).not.toHaveBeenCalled();
    releaseStart();
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalled());
    const frame = JSON.parse(child.stdin.write.mock.calls[0]![0] as string) as { requestId: string };
    child.stdout.emit("data", Buffer.from(JSON.stringify({ version: 1, type: "done", requestId: frame.requestId, state: "ok", dataClass: "workspace", content: "gated" }) + "\n"));
    await expect(pending).resolves.toMatchObject({ state: "ok", content: "gated" });
    await kernel.close();
  });

  it("includes a verifiable process-group identity in durable-start evidence", async () => {
    let started: unknown;
    const channel = createIpPythonOwnedProcessChannel({
      pythonExecutable: "/usr/bin/python3",
      onStarted: (event) => { started = event; },
      terminationGraceMs: 25,
    });
    try {
      expect(started).toMatchObject({
        event: "started",
        processRef: channel.processRef,
        processPid: channel.processPid,
        processGroupId: String(channel.processPid),
        processSessionId: expect.any(String),
        processStartTime: expect.any(String),
      });
    } finally { await channel.close(); }
  });

  it("rejects an execute request from a different bound session or Goal", async () => {
    const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 25 });
    const binding = { sessionId: "session-bound", commandId: "command-1", toolCallId: "tool-1", operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", pathScope: ["/tmp/project"], outboundDataClasses: ["workspace"], authorityPolicyVersion: 1, controlEpoch: "epoch-1", budgetEffectCents: 0 };
    const kernel = createIpPythonTwoStageProcessKernel({ createProcess: () => channel, prepareEffect: async () => ({ result: { state: "ok", dataClass: "workspace", content: "value" }, commit: async (lease) => { await lease.assertValid(); return { state: "ok", dataClass: "workspace", content: "value" }; }, rollback: async () => {} }), fencingToken: "fence-1", approve: async (_effects, blockDigest) => ({ approvalId: "approval-1", blockDigest, fencingToken: "fence-1" }), isFencingCurrent: () => true, recordEffectResult: async () => {}, recordStageBoundary: async () => {} }, "session-bound", binding);
    try {
      await expect(kernel.execute({ sessionId: "other-session", code: "print('no')" })).resolves.toMatchObject({ state: "unknown", reason: "session_identity_changed" });
      await expect(kernel.execute({ sessionId: "session-bound", binding: { ...binding, goalId: "other-goal" }, code: "print('no')" })).resolves.toMatchObject({ state: "unknown", reason: "session_binding_changed" });
    } finally { await kernel.close?.(); }
  });

  it("routes a real child through collect and applies an approved host request once", async () => {
    const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 25 });
    const applied: string[] = [];
    let consumed = 0;
    const kernel = createIpPythonTwoStageProcessKernel({
      createProcess: () => channel,
      prepareEffect: async (request) => ({
        result: { state: "ok", dataClass: "workspace", content: "value" },
        commit: async (lease) => { await lease.assertValid(); applied.push(request.method); return { state: "ok", dataClass: "workspace", content: "value" }; },
        rollback: async () => {},
      }),
      fencingToken: "fence-1",
      approve: async (_effects, blockDigest) => ({ approvalId: "approval-1", blockDigest, fencingToken: "fence-1" }),
      consumeApproval: async () => { consumed += 1; return true; },
      isFencingCurrent: () => true,
      recordEffectResult: async () => {},
      recordStageBoundary: async () => {},
    }, "session-two-stage");
    try {
      await expect(kernel.execute({ sessionId: "session-two-stage", code: "print(read_file('a.txt'))" })).resolves.toMatchObject({ state: "ok", content: "value\n" });
      expect(applied).toEqual(["read_file"]);
      expect(consumed).toBe(1);
    } finally { await kernel.close?.(); }
  });

  it("runs the constrained real child through the owned channel", async () => {
    const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 25 });
    const kernel = createIpPythonProcessKernel({ createProcess: () => channel, hostRequest: async () => ({ state: "error", dataClass: "workspace", content: "not used" }) }, "session-owned-real");
    try {
      await expect(kernel.execute({ sessionId: "session-owned-real", code: "print('owned-child')" })).resolves.toMatchObject({ state: "ok", content: "owned-child\n" });
    } finally { await kernel.close(); }
  });

  it("reaps a persisted process group when the leader has not been observed", async () => {
    let started: Record<string, unknown> | undefined;
    const channel = createIpPythonOwnedProcessChannel({
      pythonExecutable: "/usr/bin/python3",
      onStarted: (event) => { started = event as unknown as Record<string, unknown>; },
      terminationGraceMs: 25,
      spawnProcess: (_command, _args, options) => spawn("/bin/sh", ["-c", "sleep 30"], options) as unknown as ChildProcessWithoutNullStreams,
    });
    try {
      expect(started).toBeDefined();
      const result = await reapIpPythonProcessGroup({
        processPid: channel.processPid,
        processGroupId: started!.processGroupId as string,
        processSessionId: started!.processSessionId as string,
        processStartTime: started!.processStartTime as string,
      }, { terminationGraceMs: 25 });
      expect(result).toBe("reaped");
      expect(() => process.kill(-channel.processPid, 0)).toThrow();
    } finally { await channel.close(); }
  });

  it("reaps same-session descendants after the persisted group leader exits", async () => {
    const leader = spawn("/bin/sh", ["-c", "sleep 30 & exit 0"], { detached: true, stdio: "ignore" });
    const processPid = leader.pid;
    expect(processPid).toBeTypeOf("number");
    const stat = readFileSync(`/proc/${processPid as number}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const identity = {
      processPid: processPid as number,
      processGroupId: fields[2]!,
      processSessionId: fields[3]!,
      processStartTime: fields[19]!,
    };
    await new Promise<void>((resolve) => leader.once("exit", () => resolve()));
    expect(() => process.kill(-identity.processPid, 0)).not.toThrow();
    const result = await reapIpPythonProcessGroup(identity, { terminationGraceMs: 25 });
    expect(result).toBe("unknown");
    expect(() => process.kill(-identity.processPid, 0)).not.toThrow();
    try { process.kill(-identity.processPid, "SIGKILL"); } catch { /* cleanup */ }
  });

  it("fails closed when a live leader PID has a mismatched process generation", async () => {
    const leader = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
    const processPid = leader.pid;
    expect(processPid).toBeTypeOf("number");
    const stat = readFileSync(`/proc/${processPid as number}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const identity = {
      processPid: processPid as number,
      processGroupId: fields[2]!,
      processSessionId: fields[3]!,
      processStartTime: `${fields[19]}-stale`,
    };
    try {
      await expect(reapIpPythonProcessGroup(identity, { terminationGraceMs: 25 })).resolves.toBe("unknown");
      expect(() => process.kill(-(processPid as number), 0)).not.toThrow();
    } finally {
      try { process.kill(-(processPid as number), "SIGKILL"); } catch { /* cleanup */ }
    }
  });

  it("fails closed when a mismatched live PID has no persisted process group", async () => {
    const leader = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
    const processPid = leader.pid;
    expect(processPid).toBeTypeOf("number");
    const stat = readFileSync(`/proc/${processPid as number}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const identity = {
      processPid: processPid as number,
      processGroupId: "999999",
      processSessionId: fields[3]!,
      processStartTime: `${fields[19]}-stale`,
    };
    try {
      await expect(reapIpPythonProcessGroup(identity, { terminationGraceMs: 25 })).resolves.toBe("unknown");
      expect(() => process.kill(processPid as number, 0)).not.toThrow();
    } finally {
      try { process.kill(-(processPid as number), "SIGKILL"); } catch { /* cleanup */ }
      try { process.kill(processPid as number, "SIGKILL"); } catch { /* cleanup */ }
    }
  });

  it("kills the owned group when the parent owner disappears", async () => {
    const owner = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
    const ownerPid = owner.pid;
    expect(ownerPid).toBeTypeOf("number");
    const stat = readFileSync(`/proc/${ownerPid as number}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const ownerStartTime = stat.slice(commandEnd + 2).trim().split(/\s+/)[19];
    expect(ownerStartTime).toBeTypeOf("string");
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    const shellCode = `/usr/bin/python3 -I -S -c ${quote(IPYTHON_PYTHON_BOOTSTRAP)} & /bin/sleep 30 & wait`;
    let channel: ReturnType<typeof createIpPythonOwnedProcessChannel> | undefined;
    try {
      channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", parentPid: ownerPid as number, parentIdentity: ownerStartTime as string, terminationGraceMs: 100, spawnProcess: (_command, _args, options) => spawn("/bin/sh", ["-c", shellCode], options) as unknown as ChildProcessWithoutNullStreams });
      const closed = new Promise<string | undefined>((resolve) => channel!.onClose(resolve));
      owner.kill("SIGKILL");
      await expect(Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("parent crash cleanup timed out")), 2_000))])).resolves.toBeDefined();
    } finally {
      try { owner.kill("SIGKILL"); } catch { /* owner may already be gone */ }
      await channel?.close();
    }
  });

  it("journals an unexpected child close as an orphan without inferring a terminal outcome", async () => {
    const child = new FakeChild();
    const events: unknown[] = [];
    const channel = createIpPythonOwnedProcessChannel({
      pythonExecutable: "/usr/bin/python3",
      processRef: "process-orphan-1",
      sessionId: "session-orphan-1",
      projectId: "project-orphan-1",
      goalId: "goal-orphan-1",
      onLifecycle: (event) => { events.push(event); },
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    child.closeListener?.(null, "SIGKILL");
    await channel.close();
    expect(channel.processRef).toBe("process-orphan-1");
    expect(events).toEqual([expect.objectContaining({ event: "orphaned", processRef: "process-orphan-1", processPid: 4321, reason: "child_closed_without_owner_shutdown" })]);
  });

  it("falls back to direct leader teardown when group identity is unavailable after leader exit", async () => {
    const child = new FakeChild();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 1, spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams });
      child.exitListener?.(0, null);
      await channel.close();
      expect(kill).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    } finally { kill.mockRestore(); }
  });

  it("kills a real descendant that remains in the owned process group", async () => {
    const child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const pid = child.pid;
    expect(pid).toBeTypeOf("number");
    try {
      const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 100, spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams });
      await channel.close();
      expect(() => process.kill(-(pid as number), 0)).toThrow();
    } finally {
      try { process.kill(-(pid as number), "SIGKILL"); } catch { /* the group is already gone */ }
    }
  });

  it("terminates the detached process group on close", async () => {
    const child = new FakeChild();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 1, spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams });
      await channel.close();
      expect(kill).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.stdin.end).toHaveBeenCalledOnce();
    } finally {
      kill.mockRestore();
    }
  });
});
