import type { ChildProcess } from "node:child_process";

export const EMBEDDED_DATABASE_STARTUP_WAIT_MS = 30_000;
const DEFAULT_DIAGNOSTIC_TAIL_CHARS = 8_192;

export function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? createAbortError());
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(signal?.reason ?? createAbortError()));
    const timer = setTimeout(() => finish(resolve), delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function waitForSharedStartup<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? createAbortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(signal.reason ?? createAbortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

export function waitForEmbeddedDatabaseReady(
  child: ChildProcess,
  timeoutMs = EMBEDDED_DATABASE_STARTUP_WAIT_MS,
  diagnosticTailChars = DEFAULT_DIAGNOSTIC_TAIL_CHARS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdoutTail = "";
    let stderrTail = "";
    let pendingLine = "";
    let settled = false;

    const diagnostics = (): string => {
      const output = [
        stdoutTail.trim() === "" ? "" : `stdout: ${stdoutTail.trim()}`,
        stderrTail.trim() === "" ? "" : `stderr: ${stderrTail.trim()}`,
      ]
        .filter(Boolean)
        .join("\n");
      return output === "" ? "" : `\n${output}`;
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onStdout = (chunk: Buffer | string): void => {
      const text = String(chunk);
      stdoutTail = appendTail(stdoutTail, text, diagnosticTailChars);
      pendingLine += text;
      const lines = pendingLine.split("\n");
      pendingLine = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("READY ")) {
          finish(() => resolve(line.slice("READY ".length).trim()));
          return;
        }
      }
      if (pendingLine.length > diagnosticTailChars) pendingLine = pendingLine.slice(-diagnosticTailChars);
    };
    const onStderr = (chunk: Buffer | string): void => {
      stderrTail = appendTail(stderrTail, String(chunk), diagnosticTailChars);
    };
    const onError = (error: Error): void => finish(() => reject(error));
    const onClose = (code: number | null): void => {
      const output = diagnostics();
      const message =
        output.trim() === ""
          ? `Embedded database child exited with code ${code ?? "unknown"}`
          : `Embedded database child exited with code ${code ?? "unknown"}${output}`;
      finish(() => reject(new Error(message)));
    };

    const timer = setTimeout(() => {
      const error = new Error(`Embedded database child did not become ready within ${timeoutMs} ms${diagnostics()}`);
      try {
        child.kill("SIGTERM");
      } catch {
        /* already exited */
      }
      finish(() => reject(error));
    }, timeoutMs);
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function appendTail(current: string, chunk: string, maxChars: number): string {
  const combined = current + chunk;
  return combined.length > maxChars ? combined.slice(-maxChars) : combined;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}
