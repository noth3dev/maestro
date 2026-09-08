import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createIpPythonOwnedProcessChannel } from "./ipython-process-adapter.js";
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

  it("runs the constrained real child through the owned channel", async () => {
    const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: "/usr/bin/python3", terminationGraceMs: 25 });
    const kernel = createIpPythonProcessKernel({ createProcess: () => channel, hostRequest: async () => ({ state: "error", dataClass: "workspace", content: "not used" }) }, "session-owned-real");
    try {
      await expect(kernel.execute({ sessionId: "session-owned-real", code: "print('owned-child')" })).resolves.toMatchObject({ state: "ok", content: "owned-child\n" });
    } finally { await kernel.close(); }
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
