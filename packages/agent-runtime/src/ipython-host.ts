import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { IpPythonExecutionRequest, IpPythonExecutionResult, IpPythonKernel, IpPythonSessionBinding } from "./ipython-tool.js";

export const IPYTHON_PROTOCOL_VERSION = 1 as const;

export interface IpPythonReadyFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly runtime: "python";
}

type DataClass = IpPythonExecutionResult["dataClass"];

export interface IpPythonExecuteFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "execute";
  readonly requestId: string;
  readonly sessionId: string;
  readonly code: string;
}

export interface IpPythonHostRequestFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "host_request";
  readonly requestId: string;
  readonly hostRequestId: string;
  readonly method: string;
  readonly payload: unknown;
}

export interface IpPythonDoneFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "done";
  readonly requestId: string;
  readonly state: IpPythonExecutionResult["state"];
  readonly dataClass: DataClass;
  readonly content: string;
  readonly reason?: string;
  readonly truncated?: boolean;
}

export interface IpPythonInterruptFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "interrupt";
  readonly requestId: string;
}

export interface IpPythonShutdownFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "shutdown";
}

export interface IpPythonEventFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "event";
  readonly requestId: string;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface IpPythonErrorFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "error";
  readonly requestId: string;
  readonly reason: string;
}

export interface IpPythonHostResponseFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "host_response";
  readonly requestId: string;
  readonly hostRequestId: string;
  readonly ok: boolean;
  readonly result?: IpPythonExecutionResult;
  readonly error?: string;
}

export type IpPythonFrame = IpPythonReadyFrame | IpPythonExecuteFrame | IpPythonHostRequestFrame | IpPythonDoneFrame | IpPythonEventFrame | IpPythonErrorFrame | IpPythonHostResponseFrame | IpPythonInterruptFrame | IpPythonShutdownFrame;

export interface IpPythonTransport {
  send(frame: IpPythonFrame): void | Promise<void>;
  onFrame(listener: (frame: unknown) => void): () => void;
  onClose(listener: (reason?: string) => void): () => void;
  interrupt(requestId: string): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface IpPythonLineChannel {
  write(data: string): void | Promise<void>;
  onData(listener: (chunk: string | Buffer) => void): () => void;
  onClose(listener: (reason?: string) => void): () => void;
  close(): void | Promise<void>;
}

const MAX_FRAME_BYTES = 1_048_576;

export function createIpPythonJsonLinesTransport(channel: IpPythonLineChannel): IpPythonTransport {
  const decoder = new StringDecoder("utf8");
  const frameListeners = new Set<(frame: unknown) => void>();
  const closeListeners = new Set<(reason?: string) => void>();
  let pending = "";
  let closed = false;
  const removeData = channel.onData((chunk) => {
    pending += decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    if (Buffer.byteLength(pending, "utf8") > MAX_FRAME_BYTES) {
      pending = "";
      for (const listener of closeListeners) listener("protocol_frame_too_large");
      return;
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line.trim() === "") continue;
      try { for (const listener of frameListeners) listener(JSON.parse(line)); }
      catch { for (const listener of frameListeners) listener(undefined); }
    }
  });
  const removeChannelClose = channel.onClose((reason) => { for (const listener of closeListeners) listener(reason); });
  return {
    send(frame) {
      if (closed) throw new Error("IPython transport is closed");
      return channel.write(`${JSON.stringify(frame)}\n`);
    },
    onFrame(listener) { frameListeners.add(listener); return () => frameListeners.delete(listener); },
    onClose(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },
    interrupt(requestId) { return channel.write(`${JSON.stringify({ version: IPYTHON_PROTOCOL_VERSION, type: "interrupt", requestId })}\n`); },
    async close() {
      if (closed) return;
      closed = true;
      removeData();
      removeChannelClose();
      const listeners = [...closeListeners];
      closeListeners.clear();
      for (const listener of listeners) listener("closed");
      await channel.write(`${JSON.stringify({ version: IPYTHON_PROTOCOL_VERSION, type: "shutdown" })}\n`);
      await channel.close();
    },
  };
}

export interface IpPythonHostRequest {
  readonly requestId: string;
  readonly hostRequestId: string;
  readonly method: string;
  readonly payload: unknown;
}

export interface IpPythonKernelOptions {
  readonly transport: IpPythonTransport;
  readonly hostRequest: (request: IpPythonHostRequest, binding?: IpPythonSessionBinding) => IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  readonly onEvent?: (event: Pick<IpPythonEventFrame, "requestId" | "stream" | "text">) => void;
  /** Maximum time allowed for a cooperative interrupt before the child is closed. */
  readonly interruptGraceMs?: number;
  /** Require a version-checked child ready frame before the first cell. */
  readonly requireReady?: boolean;
  readonly readyTimeoutMs?: number;
}

export type IpPythonHostBinding = IpPythonSessionBinding;

export interface IpPythonReadOnlyGateway {
  readFile(binding: IpPythonHostBinding, relativePath: string): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitRevision(binding: IpPythonHostBinding, ref: string): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
}

export interface IpPythonReadOnlyValueAdapters {
  readFile(binding: IpPythonHostBinding, relativePath: string): string | Promise<string>;
  gitRevision(binding: IpPythonHostBinding, ref: string): string | Promise<string>;
}

/** Adapt already-authorized file/Git ports into the host protocol result envelope. */
export function createIpPythonReadOnlyGateway(adapters: IpPythonReadOnlyValueAdapters): IpPythonReadOnlyGateway {
  return {
    async readFile(_binding, relativePath) { return { state: "ok", dataClass: "workspace", content: await adapters.readFile(_binding, relativePath) }; },
    async gitRevision(_binding, ref) { return { state: "ok", dataClass: "workspace", content: await adapters.gitRevision(_binding, ref) }; },
  };
}

export class IpPythonProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpPythonProtocolError";
  }
}

export class IpPythonKernelBusyError extends Error {
  constructor() {
    super("IPython kernel is busy");
    this.name = "IpPythonKernelBusyError";
  }
}

export interface IpPythonParentWatchdog {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
}

export interface IpPythonParentWatchdogOptions {
  readonly parentPid: number;
  /** Stable OS identity captured for the expected parent PID; prevents PID reuse. */
  readonly parentIdentity: string;
  readonly intervalMs?: number;
  readonly isAlive?: (parentPid: number) => boolean | Promise<boolean>;
  readonly readIdentity?: (parentPid: number) => string | Promise<string>;
  /** Must terminate the complete owned process group, not only the leader. */
  readonly terminate: (reason: "parent_dead" | "parent_identity_mismatch" | "parent_liveness_unknown") => void | Promise<void>;
}

export function readIpPythonParentIdentity(parentPid: number): string {
  try {
    const stat = readFileSync(`/proc/${parentPid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields = commandEnd < 0 ? [] : stat.slice(commandEnd + 2).trim().split(/\s+/);
    const startTime = fields[19];
    if (startTime === undefined || startTime === "") throw new Error("process start time is unavailable");
    return startTime;
  } catch { throw new Error("IPython parent identity is unavailable"); }
}

function defaultParentIsAlive(parentPid: number): boolean {
  try { process.kill(parentPid, 0); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

export function createIpPythonParentWatchdog(options: IpPythonParentWatchdogOptions): IpPythonParentWatchdog {
  if (!Number.isSafeInteger(options.parentPid) || options.parentPid <= 0) throw new Error("IPython parent PID is invalid");
  if (typeof options.parentIdentity !== "string" || options.parentIdentity.trim() === "") throw new Error("IPython parent identity is required");
  const intervalMs = options.intervalMs ?? 500;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error("IPython parent watchdog interval is invalid");
  const isAlive = options.isAlive ?? defaultParentIsAlive;
  const readIdentity = options.readIdentity ?? readIpPythonParentIdentity;
  let timer: ReturnType<typeof setInterval> | undefined;
  let triggered = false;
  let checkInFlight = false;
  const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
  const checkNow = async () => {
    if (triggered || checkInFlight) return;
    checkInFlight = true;
    try {
      let alive: boolean;
      try { alive = await isAlive(options.parentPid); }
      catch { triggered = true; stop(); await options.terminate("parent_liveness_unknown"); return; }
      if (!alive) {
        triggered = true;
        stop();
        await options.terminate("parent_dead");
        return;
      }
      let identity: string;
      try { identity = await readIdentity(options.parentPid); }
      catch { triggered = true; stop(); await options.terminate("parent_liveness_unknown"); return; }
      if (identity === options.parentIdentity) return;
      triggered = true;
      stop();
      await options.terminate("parent_identity_mismatch");
    } finally { checkInFlight = false; }
  };
  return {
    start() { if (timer === undefined && !triggered) { timer = setInterval(() => { void checkNow(); }, intervalMs); timer.unref?.(); } },
    stop,
    checkNow,
  };
}


function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new IpPythonProtocolError("IPython host payload must be an object");
  return payload as Record<string, unknown>;
}

function relativeReadPath(value: unknown): string {
  const path = requiredString(value, "path");
  if (path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => part === "..")) throw new IpPythonProtocolError("IPython read path is outside the Goal scope");
  return path;
}

function gitRef(value: unknown): string {
  const ref = requiredString(value, "ref");
  if (ref.includes("\0") || /\s/.test(ref)) throw new IpPythonProtocolError("IPython Git ref is invalid");
  return ref;
}

function validateHostResult(value: IpPythonExecutionResult, binding: IpPythonHostBinding): IpPythonExecutionResult {
  if (value === null || typeof value !== "object" || !["ok", "error", "cancelled", "unknown"].includes(value.state) || typeof value.content !== "string" || !["public", "workspace", "private", "pii", "phi", "secret"].includes(value.dataClass)) throw new IpPythonProtocolError("IPython host result is invalid");
  if (!binding.outboundDataClasses.includes(value.dataClass)) throw new IpPythonProtocolError("IPython host result data class is outside the Goal scope");
  if (Buffer.byteLength(value.content, "utf8") > MAX_FRAME_BYTES) throw new IpPythonProtocolError("IPython host result exceeds the output limit");
  return value;
}

function stableBindingKey(binding: IpPythonHostBinding): string {
  const { commandId: _commandId, toolCallId: _toolCallId, ...stableBinding } = binding;
  return JSON.stringify(stableBinding);
}

export function createReadOnlyHostRequestHandler(options: { readonly binding: IpPythonHostBinding; readonly gateway: IpPythonReadOnlyGateway }): (request: IpPythonHostRequest, binding?: IpPythonHostBinding) => Promise<IpPythonExecutionResult> {
  return async (request, requestBinding) => {
    const binding = requestBinding ?? options.binding;
    if (stableBindingKey(binding) !== stableBindingKey(options.binding)) throw new IpPythonProtocolError("IPython host binding identity changed");
    const payload = payloadRecord(request.payload);
    if (request.method === "read_file") return validateHostResult(await options.gateway.readFile(binding, relativeReadPath(payload.path)), binding);
    if (request.method === "git_revision") return validateHostResult(await options.gateway.gitRevision(binding, gitRef(payload.ref)), binding);
    throw new IpPythonProtocolError(`IPython host method is not allowed: ${request.method}`);
  };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new IpPythonProtocolError("IPython frame must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new IpPythonProtocolError(`IPython frame ${name} is required`);
  return value;
}

function dataClass(value: unknown): DataClass {
  if (!["public", "workspace", "private", "pii", "phi", "secret"].includes(value as string)) throw new IpPythonProtocolError("IPython frame data class is invalid");
  return value as DataClass;
}

function executionState(value: unknown): IpPythonExecutionResult["state"] {
  if (!["ok", "error", "cancelled", "unknown"].includes(value as string)) throw new IpPythonProtocolError("IPython frame execution state is invalid");
  return value as IpPythonExecutionResult["state"];
}

export function parseIpPythonFrame(value: unknown): IpPythonFrame {
  const input = record(value);
  if (input.version !== IPYTHON_PROTOCOL_VERSION) throw new IpPythonProtocolError("IPython protocol version is unsupported");
  const type = input.type;
  if (type === "ready") {
    if (input.runtime !== "python") throw new IpPythonProtocolError("IPython runtime is unsupported");
    return { version: IPYTHON_PROTOCOL_VERSION, type, runtime: "python" };
  }
  if (type === "execute") {
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), sessionId: requiredString(input.sessionId, "sessionId"), code: requiredString(input.code, "code") };
  }
  if (type === "host_request") {
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), hostRequestId: requiredString(input.hostRequestId, "hostRequestId"), method: requiredString(input.method, "method"), payload: input.payload };
  }
  if (type === "done") {
    const content = typeof input.content === "string" ? input.content : (() => { throw new IpPythonProtocolError("IPython frame content is required"); })();
    if (input.truncated !== undefined && typeof input.truncated !== "boolean") throw new IpPythonProtocolError("IPython frame truncation flag is invalid");
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), state: executionState(input.state), dataClass: dataClass(input.dataClass), content, ...(input.reason === undefined ? {} : { reason: requiredString(input.reason, "reason") }), ...(input.truncated === undefined ? {} : { truncated: input.truncated }) };
  }
  if (type === "interrupt") return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId") };
  if (type === "shutdown") return { version: IPYTHON_PROTOCOL_VERSION, type };
  if (type === "event") {
    const stream = input.stream;
    if (stream !== "stdout" && stream !== "stderr") throw new IpPythonProtocolError("IPython event stream is invalid");
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), stream, text: typeof input.text === "string" ? input.text : (() => { throw new IpPythonProtocolError("IPython event text is required"); })() };
  }
  if (type === "error") return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), reason: requiredString(input.reason, "reason") };
  if (type === "host_response") {
    if (typeof input.ok !== "boolean") throw new IpPythonProtocolError("IPython host response status is invalid");
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), hostRequestId: requiredString(input.hostRequestId, "hostRequestId"), ok: input.ok, ...(input.result === undefined ? {} : { result: input.result as IpPythonExecutionResult }), ...(input.error === undefined ? {} : { error: requiredString(input.error, "error") }) };
  }
  throw new IpPythonProtocolError("IPython frame type is unsupported");
}

export interface IpPythonProcessKernelOptions extends Omit<IpPythonKernelOptions, "transport"> {
  readonly createProcess: (sessionId: string, binding?: IpPythonSessionBinding) => IpPythonLineChannel;
  readonly parentWatchdog?: IpPythonParentWatchdog;
}

export function createIpPythonProcessKernel(options: IpPythonProcessKernelOptions, sessionId: string, binding?: IpPythonSessionBinding): IpPythonKernel {
  const kernel = createIpPythonKernel({ transport: createIpPythonJsonLinesTransport(options.createProcess(sessionId, binding)), hostRequest: options.hostRequest, requireReady: true, ...(options.interruptGraceMs === undefined ? {} : { interruptGraceMs: options.interruptGraceMs }), ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }), ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }) });
  options.parentWatchdog?.start();
  return {
    execute: kernel.execute,
    ...(kernel.interrupt === undefined ? {} : { interrupt: kernel.interrupt }),
    async close() { options.parentWatchdog?.stop(); await kernel.close?.(); },
  };
}

interface PendingCell {
  readonly requestId: string;
  readonly sessionId: string;
  readonly binding?: IpPythonSessionBinding;
  readonly resolve: (result: IpPythonExecutionResult) => void;
  readonly reject: (error: unknown) => void;
}

export function createIpPythonKernel(options: IpPythonKernelOptions): IpPythonKernel {
  let active: PendingCell | undefined;
  let interruptTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let ready = options.requireReady !== true;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: unknown) => void) | undefined;
  const readyPromise = ready ? Promise.resolve() : new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const clearInterruptTimer = () => { if (interruptTimer !== undefined) { clearTimeout(interruptTimer); interruptTimer = undefined; } };
  const takeActive = () => { const pending = active; active = undefined; clearInterruptTimer(); return pending; };
  const removeFrameListener = options.transport.onFrame((raw) => {
    let frame: IpPythonFrame;
    try { frame = parseIpPythonFrame(raw); } catch (error) {
      if (!ready) { rejectReady?.(error); rejectReady = undefined; resolveReady = undefined; }
      const pending = takeActive();
      pending?.reject(error);
      return;
    }
    if (frame.type === "ready") {
      ready = true;
      resolveReady?.();
      resolveReady = undefined;
      rejectReady = undefined;
      return;
    }
    if (frame.type === "host_request") {
      if (active === undefined || active.requestId !== frame.requestId) return;
      Promise.resolve(options.hostRequest({ requestId: frame.requestId, hostRequestId: frame.hostRequestId, method: frame.method, payload: frame.payload }, active.binding)).then((result) => options.transport.send({ version: IPYTHON_PROTOCOL_VERSION, type: "host_response", requestId: frame.requestId, hostRequestId: frame.hostRequestId, ok: true, result })).catch((error) => options.transport.send({ version: IPYTHON_PROTOCOL_VERSION, type: "host_response", requestId: frame.requestId, hostRequestId: frame.hostRequestId, ok: false, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (frame.type !== "event" && frame.type !== "done" && frame.type !== "error") return;
    if (active === undefined || frame.requestId !== active.requestId) return;
    if (frame.type === "event") { options.onEvent?.(frame); return; }
    if (frame.type === "done") { const pending = takeActive(); pending?.resolve({ state: frame.state, dataClass: frame.dataClass, content: frame.content, ...(frame.reason === undefined ? {} : { reason: frame.reason }), ...(frame.truncated === undefined ? {} : { truncated: frame.truncated }) }); return; }
    if (frame.type === "error") { const pending = takeActive(); pending?.resolve({ state: "unknown", dataClass: "workspace", content: frame.reason, reason: frame.reason }); }
  });
  const removeCloseListener = options.transport.onClose((reason) => {
    if (!ready) { rejectReady?.(new Error(reason ?? "IPython child closed before ready")); rejectReady = undefined; resolveReady = undefined; }
    if (active === undefined) return;
    const pending = takeActive();
    pending?.resolve({ state: "unknown", dataClass: "workspace", content: reason ?? "IPython child closed", reason: "child_closed" });
  });

  return {
    async execute(request: IpPythonExecutionRequest): Promise<IpPythonExecutionResult> {
      if (closed) throw new Error("IPython kernel is closed");
      if (!ready) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([readyPromise, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error("handshake_timeout")), options.readyTimeoutMs ?? 5_000); })]);
        } catch {
          return { state: "unknown", dataClass: "workspace", content: "IPython child did not complete the ready handshake", reason: "handshake_timeout" };
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
      if (active !== undefined) throw new IpPythonKernelBusyError();
      const requestId = `cell-${randomUUID()}`;
      const result = new Promise<IpPythonExecutionResult>((resolve, reject) => { active = { requestId, sessionId: request.sessionId, ...(request.binding === undefined ? {} : { binding: request.binding }), resolve, reject }; });
      try {
        await options.transport.send({ version: IPYTHON_PROTOCOL_VERSION, type: "execute", requestId, sessionId: request.sessionId, code: request.code });
      } catch (error) {
        const pending = takeActive();
        if (pending !== undefined) pending.reject(error);
      }
      return result;
    },
    async interrupt(sessionId: string): Promise<void> {
      if (active?.sessionId !== sessionId) return;
      await options.transport.interrupt(active.requestId);
      if (active?.sessionId === sessionId) {
        const graceMs = options.interruptGraceMs ?? 250;
        interruptTimer = setTimeout(() => { void options.transport.close(); }, graceMs);
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const pending = takeActive();
      if (pending !== undefined) pending.resolve({ state: "unknown", dataClass: "workspace", content: "IPython kernel closed", reason: "kernel_closed" });
      removeFrameListener();
      removeCloseListener();
      await options.transport.close();
    },
  };
}
