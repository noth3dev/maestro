import { StringDecoder } from "node:string_decoder";
import type { IpPythonExecutionResult } from "../ipython-tool.js";

export const IPYTHON_PROTOCOL_VERSION = 1 as const;

export interface IpPythonReadyFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly runtime: "python";
}

export type DataClass = IpPythonExecutionResult["dataClass"];

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

export type IpPythonFrame =
  | IpPythonReadyFrame
  | IpPythonExecuteFrame
  | IpPythonHostRequestFrame
  | IpPythonDoneFrame
  | IpPythonEventFrame
  | IpPythonErrorFrame
  | IpPythonHostResponseFrame
  | IpPythonInterruptFrame
  | IpPythonShutdownFrame;

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

export const MAX_FRAME_BYTES = 1_048_576;

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
      try {
        for (const listener of frameListeners) listener(JSON.parse(line));
      } catch {
        for (const listener of frameListeners) listener(undefined);
      }
    }
  });
  const removeChannelClose = channel.onClose((reason) => {
    for (const listener of closeListeners) listener(reason);
  });
  return {
    send(frame) {
      if (closed) throw new Error("IPython transport is closed");
      return channel.write(`${JSON.stringify(frame)}\n`);
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    interrupt(requestId) {
      return channel.write(`${JSON.stringify({ version: IPYTHON_PROTOCOL_VERSION, type: "interrupt", requestId })}\n`);
    },
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
