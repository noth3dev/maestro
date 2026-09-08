import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { IPYTHON_PYTHON_BOOTSTRAP } from "./ipython-bootstrap.js";
import { readIpPythonParentIdentity } from "./ipython-host.js";
import type { IpPythonLineChannel } from "./ipython-host.js";

export interface IpPythonOwnedProcessChannel extends IpPythonLineChannel {
  onStderr(listener: (text: string) => void): () => void;
}

export interface IpPythonOwnedProcessChannelOptions {
  /** Absolute, trusted Python executable selected by Control Plane configuration. */
  readonly pythonExecutable: string;
  readonly parentPid?: number;
  readonly parentIdentity?: string;
  readonly cwd?: string;
  readonly terminationGraceMs?: number;
  readonly maxStderrBytes?: number;
  readonly spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
}

const DEFAULT_TERMINATION_GRACE_MS = 250;
const DEFAULT_MAX_STDERR_BYTES = 64_000;
const MIN_PROCESS_ID = 2;
const MAX_ALLOWED_STDERR_BYTES = 1_048_576;

function isErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function boundedPositive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${name} is invalid`);
  return result;
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch (error) { if (!isErrorCode(error, "ESRCH")) throw new Error(`IPython process group termination failed: ${signal}`); }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

function boundedUtf8(chunk: Buffer, maxBytes: number): string {
  for (let end = Math.min(chunk.byteLength, maxBytes); end > 0; end -= 1) {
    const text = chunk.subarray(0, end).toString("utf8");
    if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  }
  return "";
}

interface ProcessGroupIdentity {
  readonly sessionId: string;
  readonly leaderStartTime: string;
}

function readProcessStat(pid: number): { readonly processGroupId: string; readonly sessionId: string; readonly startTime: string } {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) throw new Error("process stat is invalid");
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
  const processGroupId = fields[2];
  const sessionId = fields[3];
  const startTime = fields[19];
  if (processGroupId === undefined || sessionId === undefined || startTime === undefined) throw new Error("process stat is incomplete");
  return { processGroupId, sessionId, startTime };
}

function readProcessGroupIdentity(pid: number): ProcessGroupIdentity | undefined {
  try {
    const stat = readProcessStat(pid);
    return { sessionId: stat.sessionId, leaderStartTime: stat.startTime };
  } catch { return undefined; }
}

/** Guard group signalling against killing a reused PID's unrelated session. */
function ownedProcessGroupExists(pid: number, identity: ProcessGroupIdentity | undefined): boolean {
  if (identity === undefined) return false;
  try {
    const leader = readProcessStat(pid);
    if (leader.processGroupId === String(pid) && leader.startTime === identity.leaderStartTime && leader.sessionId === identity.sessionId) return true;
  } catch { /* the leader may have exited while descendants retain the group */ }
  try {
    return readdirSync("/proc", { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) return false;
      try {
        const member = readProcessStat(Number(entry.name));
        return member.processGroupId === String(pid) && member.sessionId === identity.sessionId;
      } catch { return false; }
    });
  } catch { return false; }
}

/**
 * Own a detached Python child and expose only its line-oriented stdio. The
 * child receives no parent environment or credentials, and close targets the
 * detached process group so ordinary same-group descendants cannot outlive the
 * session owner. A descendant that deliberately calls setsid/double-forks
 * escapes group-only teardown and requires a stronger OS sandbox boundary.
 */
export function createIpPythonOwnedProcessChannel(options: IpPythonOwnedProcessChannelOptions): IpPythonOwnedProcessChannel {
  if (typeof options.pythonExecutable !== "string" || options.pythonExecutable.trim() === "" || !options.pythonExecutable.startsWith("/")) throw new Error("IPython Python executable must be an absolute path");
  const parentPid = options.parentPid ?? process.pid;
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error("IPython parent PID is invalid");
  const parentIdentity = options.parentIdentity ?? readIpPythonParentIdentity(parentPid);
  if (parentIdentity.trim() === "") throw new Error("IPython parent identity is invalid");
  const terminationGraceMs = boundedPositive(options.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS, "IPython termination grace");
  const maxStderrBytes = boundedPositive(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES, "IPython stderr limit");
  if (maxStderrBytes > MAX_ALLOWED_STDERR_BYTES) throw new Error("IPython stderr limit is invalid");
  const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
  const child = spawnProcess(options.pythonExecutable, ["-I", "-S", "-c", IPYTHON_PYTHON_BOOTSTRAP], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", LANG: "C.UTF-8", MAESTRO_PARENT_PID: String(parentPid), MAESTRO_PARENT_IDENTITY: parentIdentity, MAESTRO_OWNED_PROCESS_GROUP: "1" },
  });
  // Attach an error listener before inspecting handles. An absolute path does
  // not prove that the executable or cwd can actually be launched; Node emits
  // launch failures asynchronously and an unhandled error would crash the
  // Control Plane.
  child.on("error", () => {});
  const rawPid = child.pid;
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (typeof rawPid !== "number" || !Number.isSafeInteger(rawPid) || rawPid < MIN_PROCESS_ID || stdin === null || stdout === null || stderr === null) {
    try { if (typeof rawPid === "number" && rawPid >= MIN_PROCESS_ID) killProcessGroup(rawPid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* preserve the fail-closed construction error */ }
    throw new Error("IPython child process handles are unavailable");
  }
  const pid = rawPid as number;
  const groupIdentity = readProcessGroupIdentity(pid);
  let closed = false;
  let childClosedObserved = false;
  let closeNotified = false;
  let stderrBytes = 0;
  let resolveClose!: () => void;
  const childClosed = new Promise<void>((resolve) => { resolveClose = resolve; });
  const closeListeners = new Set<(reason?: string) => void>();
  const dataListeners = new Set<(chunk: string | Buffer) => void>();
  const stderrListeners = new Set<(text: string) => void>();
  let closeReason: string | undefined;
  const notifyClose = (reason: string) => {
    if (closeNotified) return;
    closeNotified = true;
    closeReason = reason;
    for (const listener of closeListeners) listener(reason);
  };
  stdout.on("data", (chunk: Buffer) => { for (const listener of dataListeners) listener(chunk); });
  stderr.on("data", (chunk: Buffer) => {
    if (stderrBytes >= maxStderrBytes) return;
    const remaining = maxStderrBytes - stderrBytes;
    const text = boundedUtf8(chunk, remaining);
    stderrBytes += Math.min(chunk.byteLength, remaining);
    if (text !== "") { for (const listener of stderrListeners) listener(text); }
  });
  let teardownPromise: Promise<void> | undefined;
  const teardown = (): Promise<void> => {
    if (teardownPromise !== undefined) return teardownPromise;
    let resolveTeardown!: () => void;
    let rejectTeardown!: (error: unknown) => void;
    teardownPromise = new Promise<void>((resolve, reject) => { resolveTeardown = resolve; rejectTeardown = reject; });
    void (async () => {
      try {
        closed = true;
        try { stdin.end(); } catch { /* the child may already be gone */ }
        if (groupIdentity !== undefined && ownedProcessGroupExists(pid, groupIdentity)) killProcessGroup(pid, "SIGTERM");
        else if (!closeNotified) { try { child.kill("SIGTERM"); } catch { /* the leader may already be gone */ } }
        await Promise.race([childClosed, delay(terminationGraceMs)]);
        if (groupIdentity !== undefined && ownedProcessGroupExists(pid, groupIdentity)) killProcessGroup(pid, "SIGKILL");
        else if (!closeNotified) { try { child.kill("SIGKILL"); } catch { /* the leader may already be gone */ } }
        await Promise.race([childClosed, delay(terminationGraceMs)]);
        if (!closeNotified) {
          const groupStillOwned = groupIdentity !== undefined && ownedProcessGroupExists(pid, groupIdentity);
          notifyClose(childClosedObserved && !groupStillOwned ? "child_closed" : "child_kill_timeout");
        }
        resolveTeardown();
      } catch (error) { rejectTeardown(error); }
    })();
    return teardownPromise;
  };
  child.on("error", () => { void teardown(); });
  child.on("exit", () => { /* retain group identity for teardown; close may follow later */ });
  child.on("close", () => { childClosedObserved = true; resolveClose(); void teardown(); });

  return {
    write(data) { if (closed) throw new Error("IPython process channel is closed"); stdin.write(data); },
    onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
    onStderr(listener) { stderrListeners.add(listener); return () => stderrListeners.delete(listener); },
    onClose(listener) {
      if (closeReason !== undefined) listener(closeReason);
      else closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close: teardown,
  };
}
