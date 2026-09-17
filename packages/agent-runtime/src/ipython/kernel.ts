import { randomUUID } from "node:crypto";
import type { IpPythonExecutionRequest, IpPythonExecutionResult, IpPythonKernel, IpPythonSessionBinding } from "../ipython-tool.js";
import {
  createIpPythonJsonLinesTransport,
  IPYTHON_PROTOCOL_VERSION,
  IpPythonKernelBusyError,
  type IpPythonFrame,
  type IpPythonLineChannel,
} from "./frames.js";
import { parseIpPythonFrame } from "./validation.js";
import type { IpPythonKernelOptions } from "./gateway.js";
import type { IpPythonParentWatchdog } from "./watchdog.js";

export interface IpPythonProcessKernelOptions extends Omit<IpPythonKernelOptions, "transport"> {
  readonly createProcess: (sessionId: string, binding?: IpPythonSessionBinding) => IpPythonLineChannel;
  readonly parentWatchdog?: IpPythonParentWatchdog;
}

export function createIpPythonProcessKernel(
  options: IpPythonProcessKernelOptions,
  sessionId: string,
  binding?: IpPythonSessionBinding,
): IpPythonKernel {
  const channel = options.createProcess(sessionId, binding);
  const processReady = (channel as IpPythonLineChannel & { readonly ready?: Promise<void> }).ready;
  const kernel = createIpPythonKernel({
    transport: createIpPythonJsonLinesTransport(channel),
    hostRequest: options.hostRequest,
    requireReady: true,
    ...(options.interruptGraceMs === undefined ? {} : { interruptGraceMs: options.interruptGraceMs }),
    ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  });
  options.parentWatchdog?.start();
  return {
    execute:
      processReady === undefined
        ? kernel.execute
        : async (request) => {
            try {
              await processReady;
            } catch (error) {
              await Promise.resolve(channel.close()).catch(() => undefined);
              throw error;
            }
            return kernel.execute(request);
          },
    ...(kernel.interrupt === undefined ? {} : { interrupt: kernel.interrupt }),
    async close() {
      options.parentWatchdog?.stop();
      await kernel.close?.();
    },
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
  const readyPromise = ready
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
  const clearInterruptTimer = () => {
    if (interruptTimer !== undefined) {
      clearTimeout(interruptTimer);
      interruptTimer = undefined;
    }
  };
  const takeActive = () => {
    const pending = active;
    active = undefined;
    clearInterruptTimer();
    return pending;
  };
  const removeFrameListener = options.transport.onFrame((raw) => {
    let frame: IpPythonFrame;
    try {
      frame = parseIpPythonFrame(raw);
    } catch (error) {
      if (!ready) {
        rejectReady?.(error);
        rejectReady = undefined;
        resolveReady = undefined;
      }
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
      Promise.resolve(
        options.hostRequest(
          { requestId: frame.requestId, hostRequestId: frame.hostRequestId, method: frame.method, payload: frame.payload },
          active.binding,
        ),
      )
        .then((result) =>
          options.transport.send({
            version: IPYTHON_PROTOCOL_VERSION,
            type: "host_response",
            requestId: frame.requestId,
            hostRequestId: frame.hostRequestId,
            ok: true,
            result,
          }),
        )
        .catch((error) =>
          options.transport.send({
            version: IPYTHON_PROTOCOL_VERSION,
            type: "host_response",
            requestId: frame.requestId,
            hostRequestId: frame.hostRequestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return;
    }
    if (frame.type !== "event" && frame.type !== "done" && frame.type !== "error") return;
    if (active === undefined || frame.requestId !== active.requestId) return;
    if (frame.type === "event") {
      options.onEvent?.(frame);
      return;
    }
    if (frame.type === "done") {
      const pending = takeActive();
      pending?.resolve({
        state: frame.state,
        dataClass: frame.dataClass,
        content: frame.content,
        ...(frame.reason === undefined ? {} : { reason: frame.reason }),
        ...(frame.truncated === undefined ? {} : { truncated: frame.truncated }),
      });
      return;
    }
    if (frame.type === "error") {
      const pending = takeActive();
      pending?.resolve({ state: "unknown", dataClass: "workspace", content: frame.reason, reason: frame.reason });
    }
  });
  const removeCloseListener = options.transport.onClose((reason) => {
    if (!ready) {
      rejectReady?.(new Error(reason ?? "IPython child closed before ready"));
      rejectReady = undefined;
      resolveReady = undefined;
    }
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
          await Promise.race([
            readyPromise,
            new Promise<void>((_, reject) => {
              timer = setTimeout(() => reject(new Error("handshake_timeout")), options.readyTimeoutMs ?? 5_000);
            }),
          ]);
        } catch {
          return {
            state: "unknown",
            dataClass: "workspace",
            content: "IPython child did not complete the ready handshake",
            reason: "handshake_timeout",
          };
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      if (active !== undefined) throw new IpPythonKernelBusyError();
      const requestId = `cell-${randomUUID()}`;
      const result = new Promise<IpPythonExecutionResult>((resolve, reject) => {
        active = {
          requestId,
          sessionId: request.sessionId,
          ...(request.binding === undefined ? {} : { binding: request.binding }),
          resolve,
          reject,
        };
      });
      try {
        await options.transport.send({
          version: IPYTHON_PROTOCOL_VERSION,
          type: "execute",
          requestId,
          sessionId: request.sessionId,
          code: request.code,
        });
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
        interruptTimer = setTimeout(() => {
          void options.transport.close();
        }, graceMs);
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const pending = takeActive();
      if (pending !== undefined)
        pending.resolve({ state: "unknown", dataClass: "workspace", content: "IPython kernel closed", reason: "kernel_closed" });
      removeFrameListener();
      removeCloseListener();
      await options.transport.close();
    },
  };
}
