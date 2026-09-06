import { CombinedAutocompleteProvider, Container, Editor, ProcessTerminal, Text, TuiAltScreen, matchesKey, type EditorTheme } from "@earendil-works/pi-tui";
import { createTuiRuntime } from "./runtime.js";
import { resolveWorkspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { createCommandRegistry } from "./commands/registry.js";
import { parseInput } from "./commands/parser.js";
import { renderShell, type TuiShellState } from "./components/shell.js";
import type { CliIo } from "../main.js";

export interface InteractiveTuiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  io: CliIo;
}

const editorTheme: EditorTheme = {
  borderColor: (text) => text,
  selectList: {
    selectedPrefix: (text) => text,
    selectedText: (text) => text,
    description: (text) => text,
    scrollInfo: (text) => text,
    noMatch: (text) => text,
  },
};

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
    const terminal = new ProcessTerminal();
    const tui = new TuiAltScreen(terminal, true);
    const root = new Container();
    const header = new Text(renderShell(state, terminal.columns).join("\n"));
    const editor = new Editor(tui, editorTheme);
    const registry = createCommandRegistry();
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider(registry.all().map((command) => ({ name: command.name, description: command.description })), workspace.cwd));
    let transcript = "";
    editor.onSubmit = (text) => {
      const parsed = parseInput(text);
      const line = parsed.kind === "command" ? `Command: /${parsed.name}${parsed.action === undefined ? "" : ` ${parsed.action}`}` : `You: ${parsed.text}`;
      transcript = transcript === "" ? line : `${transcript}\n${line}`;
      header.setText([...renderShell(state, terminal.columns), "", transcript].join("\n"));
      editor.addToHistory(text);
      root.invalidate();
      tui.requestRender(true);
    };
    root.addChild(header);
    root.addChild(editor);
    tui.setLayoutRoot(root);
    tui.setFocus(editor);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      tui.stop();
      resolve(0);
    };
    tui.addInputListener((data) => {
      if (!matchesKey(data, "ctrl+c")) return undefined;
      stop();
      return { consume: true };
    });
    const runtime = createTuiRuntime({ start: () => tui.start(), stop });
    runtime.start();
  });
}
