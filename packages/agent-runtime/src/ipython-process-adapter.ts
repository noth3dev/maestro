import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { IPYTHON_PYTHON_BOOTSTRAP } from "./ipython-bootstrap.js";
import { createIpPythonProcessKernel, executeIpPythonBlockInTwoStages, readIpPythonParentIdentity } from "./ipython-host.js";
import type { IpPythonHostRequest, IpPythonLineChannel, IpPythonProcessKernelOptions } from "./ipython-host.js";
import { sessionBindingKey } from "./ipython-tool.js";
import type { IpPythonExecutionRequest, IpPythonExecutionResult, IpPythonKernel, IpPythonSessionBinding } from "./ipython-tool.js";

export interface IpPythonProcessStartedEvent {
  readonly event: "started";
  readonly sessionId?: string;
  readonly processRef: string;
  readonly processPid: number;
  readonly parentPid: number;
  /** Captured `/proc` identity for the detached process group. */
  readonly processGroupId?: string;
  readonly processSessionId?: string;
  readonly processStartTime?: string;
  readonly projectId?: string;
  readonly goalId?: string;
}

export interface IpPythonProcessOrphanedEvent {
  readonly event: "orphaned";
  readonly sessionId?: string;
  readonly processRef: string;
  readonly processPid: number;
  readonly parentPid: number;
  readonly reason: string;
  /** The same captured group identity as the durable `started` event. */
  readonly processGroupId?: string;
  readonly processSessionId?: string;
  readonly processStartTime?: string;
  readonly projectId?: string;
  readonly goalId?: string;
}

export type IpPythonProcessLifecycleEvent = IpPythonProcessStartedEvent | IpPythonProcessOrphanedEvent

export interface IpPythonOwnedProcessChannel extends IpPythonLineChannel {
  readonly processRef: string;
  readonly processPid: number;
  /** Resolves after the durable start callback has completed. */
  readonly ready: Promise<void>;
  onStderr(listener: (text: string) => void): () => void;
}

export interface IpPythonOwnedProcessChannelOptions {
  /** Absolute, trusted Python executable selected by Control Plane configuration. */
  readonly pythonExecutable: string;
  readonly parentPid?: number;
  readonly parentIdentity?: string;
  readonly cwd?: string;
  /** Stable process generation identity persisted for restart reconciliation. */
  readonly processRef?: string;
  readonly sessionId?: string;
  readonly projectId?: string;
  readonly goalId?: string;
  /** Called after the child identity is available, before the first cell. */
  readonly onStarted?: (event: IpPythonProcessStartedEvent) => void | Promise<void>;
  /** Called when the child closes without an intentional channel close. */
  readonly onLifecycle?: (event: IpPythonProcessOrphanedEvent) => void | Promise<void>;
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

export interface IpPythonProcessGroupIdentity {
  readonly processPid: number;
  readonly processGroupId: string;
  readonly processSessionId: string;
  readonly processStartTime: string;
}

interface ProcessGroupIdentity {
  readonly processGroupId: string;
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
    return { processGroupId: stat.processGroupId, sessionId: stat.sessionId, leaderStartTime: stat.startTime };
  } catch { return undefined; }
}

type ProcessGroupOwnership = "owned" | "leader-exited" | "not-owned" | "absent" | "unknown";

/**
 * Inspect ownership without treating a live PID with a mismatched generation
 * as a reason to scan or signal a reused process group. Once the leader has
 * exited, descendants cannot prove ancestry from the persisted leader start
 * time alone; callers must therefore fail closed rather than signal the group.
 */
function inspectProcessGroupOwnership(pid: number, identity: ProcessGroupIdentity | undefined): ProcessGroupOwnership {
  if (identity === undefined) return "unknown";
  try {
    const leader = readProcessStat(pid);
    if (leader.processGroupId !== identity.processGroupId || leader.startTime !== identity.leaderStartTime || leader.sessionId !== identity.sessionId) return "not-owned";
    return "owned";
  } catch { /* the leader may have exited while descendants retain the group */ }
  try {
    const descendantExists = readdirSync("/proc", { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) return false;
      try {
        const member = readProcessStat(Number(entry.name));
        return member.processGroupId === identity.processGroupId && member.sessionId === identity.sessionId;
      } catch { return false; }
    });
    return descendantExists ? "leader-exited" : "absent";
  } catch { return "unknown"; }
}

function validProcessGroupId(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : undefined;
}

function processGroupExists(groupId: number): boolean | undefined {
  try { process.kill(-groupId, 0); return true; }
  catch (error) {
    if (isErrorCode(error, "ESRCH")) return false;
    return undefined;
  }
}

/**
 * Reap a persisted detached process group only when its `/proc` session and
 * group identity still match. A reused group ID or an uninspectable process
 * is `unknown`, never `reaped`.
 */
export async function reapIpPythonProcessGroup(
  identity: IpPythonProcessGroupIdentity,
  options: { readonly terminationGraceMs?: number } = {},
): Promise<"reaped" | "unknown"> {
  if (typeof identity.processGroupId !== "string" || typeof identity.processSessionId !== "string" || typeof identity.processStartTime !== "string") return "unknown";
  const groupId = validProcessGroupId(identity.processGroupId);
  if (groupId === undefined || !Number.isSafeInteger(identity.processPid) || identity.processPid <= 1) return "unknown";
  const groupIdentity: ProcessGroupIdentity = { processGroupId: identity.processGroupId, sessionId: identity.processSessionId, leaderStartTime: identity.processStartTime };
  const graceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  if (!Number.isSafeInteger(graceMs) || graceMs <= 0) return "unknown";
  const initialOwnership = inspectProcessGroupOwnership(identity.processPid, groupIdentity);
  if (initialOwnership === "absent") return processGroupExists(groupId) === false ? "reaped" : "unknown";
  if (initialOwnership !== "owned") return "unknown";
  try {
    killProcessGroup(groupId, "SIGTERM");
    await delay(graceMs);
    if (inspectProcessGroupOwnership(identity.processPid, groupIdentity) === "owned") killProcessGroup(groupId, "SIGKILL");
    await delay(graceMs);
  } catch { return "unknown"; }
  if (inspectProcessGroupOwnership(identity.processPid, groupIdentity) !== "absent") return "unknown";
  return processGroupExists(groupId) === false ? "reaped" : "unknown";
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
  const processRef = options.processRef ?? `ipython:${randomUUID()}`;
  if (processRef.trim() === "") throw new Error("IPython process reference is invalid");
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
  let startedReady: Promise<void>;
  try {
    startedReady = Promise.resolve(options.onStarted?.({
      event: "started",
      processRef,
      processPid: pid,
      parentPid,
      ...(groupIdentity === undefined ? {} : { processGroupId: groupIdentity.processGroupId, processSessionId: groupIdentity.sessionId, processStartTime: groupIdentity.leaderStartTime }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    }));
  } catch (error) {
    startedReady = Promise.reject(error);
  }
  let closed = false;
  let orphanNotified = false;
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
        if (groupIdentity !== undefined && inspectProcessGroupOwnership(pid, groupIdentity) === "owned") killProcessGroup(pid, "SIGTERM");
        else if (!closeNotified) { try { child.kill("SIGTERM"); } catch { /* the leader may already be gone */ } }
        await Promise.race([childClosed, delay(terminationGraceMs)]);
        if (groupIdentity !== undefined && inspectProcessGroupOwnership(pid, groupIdentity) === "owned") killProcessGroup(pid, "SIGKILL");
        else if (!closeNotified) { try { child.kill("SIGKILL"); } catch { /* the leader may already be gone */ } }
        await Promise.race([childClosed, delay(terminationGraceMs)]);
        if (!closeNotified) {
          const groupStillOwned = groupIdentity !== undefined && ["owned", "leader-exited"].includes(inspectProcessGroupOwnership(pid, groupIdentity));
          notifyClose(childClosedObserved && !groupStillOwned ? "child_closed" : "child_kill_timeout");
        }
        resolveTeardown();
      } catch (error) { rejectTeardown(error); }
    })();
    return teardownPromise;
  };
  child.on("error", () => { void teardown(); });
  child.on("exit", () => { /* retain group identity for teardown; close may follow later */ });
  child.on("close", () => {
    childClosedObserved = true;
    // A child that closes before the owner intentionally closes its channel is
    // an orphan/unknown boundary. The persistence layer decides whether it
    // can later prove reaping; this adapter never infers success or cancel.
    if (!closed && !orphanNotified) {
      orphanNotified = true;
      try {
        void Promise.resolve(options.onLifecycle?.({
          event: "orphaned",
          processRef,
          processPid: pid,
          parentPid,
          reason: "child_closed_without_owner_shutdown",
          ...(groupIdentity === undefined ? {} : { processGroupId: groupIdentity.processGroupId, processSessionId: groupIdentity.sessionId, processStartTime: groupIdentity.leaderStartTime }),
          ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
          ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
          ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
        })).catch(() => undefined);
      } catch { /* lifecycle journaling cannot weaken fail-closed teardown */ }
    }
    resolveClose();
    void teardown();
  });

  return {
    processRef,
    processPid: pid,
    ready: startedReady,
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


export interface IpPythonTwoStageProcessKernelOptions extends Omit<IpPythonProcessKernelOptions, "hostRequest"> {
  readonly prepareEffect: (request: IpPythonHostRequest, binding?: IpPythonSessionBinding) => import("./ipython-host.js").IpPythonPreparedEffect | Promise<import("./ipython-host.js").IpPythonPreparedEffect>;
  readonly fencingToken: string;
  readonly approve: import("./ipython-host.js").IpPythonTwoStageExecutionOptions["approve"];
  readonly isFencingCurrent: (fencingToken: string) => boolean | Promise<boolean>;
  readonly recordEffectResult: (index: number, request: IpPythonHostRequest, result: IpPythonExecutionResult) => void | Promise<void>;
  readonly recordStageBoundary: import("./ipython-host.js").IpPythonTwoStageExecutionOptions["recordStageBoundary"];
}

/**
 * Bind the two-stage host router to one owned process. The child is reused for
 * the collect and execute runs, while its host requests remain intent-only
 * until the orchestrator has approved and compared both stages.
 */
export function createIpPythonTwoStageProcessKernel(options: IpPythonTwoStageProcessKernelOptions, sessionId: string, binding?: IpPythonSessionBinding): IpPythonKernel {
  let activeHostRequest: ((request: IpPythonHostRequest) => Promise<IpPythonExecutionResult>) | undefined;
  let activeExecution: Promise<IpPythonExecutionResult> | undefined;
  let stopRequested = false;
  const kernel = createIpPythonProcessKernel({
    ...options,
    hostRequest: (request) => {
      if (activeHostRequest === undefined) return { state: "unknown", dataClass: "workspace", content: "IPython host request arrived outside a two-stage block", reason: "host_request_outside_block" };
      return activeHostRequest(request);
    },
  }, sessionId, binding);
  const execute = async (request: IpPythonExecutionRequest): Promise<IpPythonExecutionResult> => {
    if (request.sessionId !== sessionId) return { state: "unknown", dataClass: "workspace", content: "IPython session identity changed", reason: "session_identity_changed" };
    if (binding !== undefined && sessionBindingKey(request.binding ?? binding) !== sessionBindingKey(binding)) return { state: "unknown", dataClass: "workspace", content: "IPython session binding changed", reason: "session_binding_changed" };
    if (activeExecution !== undefined) return { state: "unknown", dataClass: "workspace", content: "IPython two-stage kernel is busy", reason: "kernel_busy" };
    stopRequested = false;
    const execution = executeIpPythonBlockInTwoStages({
    request,
    fencingToken: options.fencingToken,
    approve: options.approve,
    isFencingCurrent: options.isFencingCurrent,
    isStopRequested: () => stopRequested,
    prepareEffect: (effect) => options.prepareEffect(effect, request.binding ?? binding),
    recordEffectResult: options.recordEffectResult,
    recordStageBoundary: options.recordStageBoundary,
    runBlock: async (stageRequest, _mode, hostRequest) => {
      activeHostRequest = hostRequest;
      try { return await kernel.execute(stageRequest); }
      finally { activeHostRequest = undefined; }
    },
  });
    activeExecution = execution;
    try { return await execution; }
    finally { if (activeExecution === execution) activeExecution = undefined; }
  };
  return {
    execute,
    ...(kernel.interrupt === undefined ? {} : { interrupt: async (session) => {
      if (session !== sessionId || activeExecution === undefined) return;
      stopRequested = true;
      await kernel.interrupt?.(session);
    } }),
    async close() {
      stopRequested = true;
      const active = activeExecution;
      try { await kernel.close?.(); }
      finally { await active?.catch(() => undefined); }
    },
  };
}
