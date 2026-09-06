import { CombinedAutocompleteProvider, Container, Editor, ProcessTerminal, Text, TuiAltScreen, matchesKey, type EditorTheme } from "@earendil-works/pi-tui";
import { createApiClient, type ApiClient, type GoalEvent } from "@maestro/api-client";
import { createTuiRuntime } from "./runtime.js";
import { resolveWorkspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { createCommandRegistry } from "./commands/registry.js";
import { parseInput, type ParsedCommand } from "./commands/parser.js";
import { executeReadCommand, discoverWorkspaceProject, readDashboard } from "./commands/read-commands.js";
import { loadWorkspaceSession, saveWorkspaceSession, type WorkspaceSession } from "./session.js";
import { mergeEvents } from "./activity-stream.js";
import { renderActivityTimeline } from "./components/activity-timeline.js";
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
  const session = await loadWorkspaceSession(workspace.cwd);
  const connectionReady = connection.kind === "configured" && controlPlane?.kind === "ready";
  const project = discoverWorkspaceProject(workspace.cwd, session);
  let client: ApiClient | undefined;
  if (connectionReady && connection.kind === "configured") {
    try {
      client = createApiClient({ baseUrl: connection.apiUrl, token: connection.token });
    } catch {
      // The resolver already validates the endpoint. Keep the UI truthful if
      // a future client invariant rejects it at construction time.
      client = undefined;
    }
  }
  const state: TuiShellState = {
    workspace,
    connection: !connectionReady
      ? connection.kind !== "configured"
        ? { kind: "error", message: connection.reason }
        : { kind: "error", message: controlPlane?.kind === "unavailable" ? controlPlane.reason : "Control Plane is not reachable" }
      : client === undefined
        ? { kind: "error", message: "Control Plane client could not be created" }
        : { kind: "connected" },
    goal: { kind: "empty" },
    workers: { kind: "empty" },
    approvals: { kind: "empty" },
    budget: { kind: "empty" },
  };

  return await new Promise<number>((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiAltScreen(terminal, true);
    const root = new Container();
    const header = new Text("");
    const editor = new Editor(tui, editorTheme);
    const registry = createCommandRegistry();
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider(registry.all().map((command) => ({ name: command.name, description: command.description })), workspace.cwd));
    let transcript: string[] = [];
    let activity: GoalEvent[] = [];
    const abortController = new AbortController();
    const render = () => {
      const lines = [...renderShell(state, terminal.columns)];
      if (activity.length > 0) lines.push("", "Activity", ...renderActivityTimeline(activity, terminal.columns));
      if (transcript.length > 0) lines.push("", ...transcript);
      header.setText(lines.join("\n"));
      root.invalidate();
      tui.requestRender(true);
    };
    const append = (line: string) => {
      transcript = [...transcript.slice(-40), line];
      render();
    };
    const refreshDashboard = async () => {
      if (client === undefined || project.kind !== "attached") return;
      state.goal = { kind: "loading" };
      state.workers = { kind: "loading" };
      state.budget = { kind: "loading" };
      render();
      try {
        const dashboard = await readDashboard({ client, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }) });
        state.goal = dashboard.selectedGoal === undefined ? { kind: "empty" } : { kind: "value", value: { name: dashboard.selectedGoal.goalId, state: dashboard.selectedGoal.state } };
        state.workers = dashboard.workerCount === undefined ? { kind: "empty" } : { kind: "value", value: dashboard.workerCount };
        state.budget = dashboard.budget === undefined ? { kind: "empty" } : { kind: "value", value: { spentCents: dashboard.budget.costCents, ceilingCents: dashboard.budget.budgetCents } };
        render();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Control Plane read failed";
        state.goal = { kind: "error", message };
        state.workers = { kind: "error", message };
        state.budget = { kind: "error", message };
        render();
      }
    };
    const streamActivity = async () => {
      if (client === undefined || project.kind !== "attached") return;
      try {
        for await (const event of client.streamEvents({ projectId: project.projectId, after: session?.lastEventCursor ?? "0" }, { signal: abortController.signal })) {
          activity = mergeEvents(activity, [event]);
          const nextSession: WorkspaceSession = { workspacePath: workspace.cwd, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }), lastEventCursor: event.cursor };
          await saveWorkspaceSession(nextSession);
          render();
        }
      } catch (error) {
        if (!abortController.signal.aborted) append(`Activity stream unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    };
    const submit = async (text: string) => {
      try {
        const parsed = parseInput(text);
        if (parsed.kind === "command" && client !== undefined && project.kind === "attached" && parsed.action !== undefined) {
          const result = await executeReadCommand({ client, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }) }, parsed);
          append(`${result.title}: ${result.lines.join(" · ")}`);
        } else if (parsed.kind === "command") {
          append(`Command: /${parsed.name}${parsed.action === undefined ? "" : ` ${parsed.action}`} (unavailable until a workspace project is attached)`);
        } else {
          append(client === undefined ? `Concertmaster unavailable: ${state.connection.kind === "error" ? state.connection.message : "Control Plane client unavailable"}` : `You: ${parsed.text}`);
        }
      } catch (error) {
        append(`Input error: ${error instanceof Error ? error.message : "invalid input"}`);
      }
      editor.addToHistory(text);
    };
    editor.onSubmit = (text) => { void submit(text); };
    root.addChild(header);
    root.addChild(editor);
    tui.setLayoutRoot(root);
    tui.setFocus(editor);
    render();

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      abortController.abort();
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
    void refreshDashboard();
    void streamActivity();
  });
}
