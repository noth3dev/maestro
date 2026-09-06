import { createTuiRuntime, type TuiTerminal } from "./runtime.js";
import { resolveWorkspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { renderShell, type TuiShellState } from "./components/shell.js";
import type { CliIo } from "../main.js";

export interface InteractiveTuiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  io: CliIo;
}

function createProcessTerminal(options: InteractiveTuiOptions, state: TuiShellState, onExit: () => void): TuiTerminal {
  let onData: ((data: Buffer) => void) | undefined;
  return {
    start() {
      options.io.stdout("\x1b[2J\x1b[H" + renderShell(state, process.stdout.columns ?? 80).join("\n") + "\n");
      onData = (data) => {
        if (data[0] === 3) onExit();
      };
      process.stdin.on("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
    },
    stop() {
      if (onData !== undefined) process.stdin.off("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    },
  };
}

export async function startInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  const workspace = await resolveWorkspace(options.cwd);
  const connection = await resolveConnection(options.env);
  const controlPlane = connection.kind === "configured"
    ? await ensureLocalControlPlane({ apiUrl: connection.apiUrl, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) })
    : undefined;
  const state: TuiShellState = {
    workspace,
    connection: connection.kind !== "configured"
      ? { kind: "error", message: connection.reason }
      : controlPlane?.kind === "ready"
        ? { kind: "connected" }
        : { kind: "error", message: controlPlane?.reason ?? "Control Plane is not reachable" },
    goal: { kind: "empty" },
    workers: { kind: "empty" },
    approvals: { kind: "empty" },
    budget: { kind: "empty" },
  };
  return await new Promise<number>((resolve) => {
    let runtime: ReturnType<typeof createTuiRuntime>;
    const terminal = createProcessTerminal(options, state, () => {
      runtime.stop();
      resolve(0);
    });
    runtime = createTuiRuntime(terminal);
    runtime.start();
  });
}
