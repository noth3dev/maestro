import { CombinedAutocompleteProvider, Container, Editor, ProcessTerminal, Text, TuiAltScreen, matchesKey, type EditorTheme } from "@earendil-works/pi-tui";
import { createApiClient, type ApiClient, type GoalEvent } from "@maestro/api-client";
import { createTuiRuntime } from "./runtime.js";
import { resolveWorkspace, type Workspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { createCommandRegistry } from "./commands/registry.js";
import { createCommandPalette } from "./commands/palette.js";
import { parseInput } from "./commands/parser.js";
import { executeReadCommand, discoverWorkspaceProject, readDashboard } from "./commands/read-commands.js";
import { executeWriteCommand } from "./commands/write-commands.js";
import { renderApprovalDialog } from "./components/approval-dialog.js";
import { reconcileTuiSession, type RecoverySummary } from "./recovery.js";
import { renderRecoveryBanner } from "./components/recovery-banner.js";
import type { CriticalActionSummary, ConfirmationResult } from "./confirmation.js";
import { advanceWorkspaceSession, attachWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession, startNewConversationSession, type WorkspaceSession } from "./session.js";
import { mergeEvents, subscribeToEvents } from "./activity-stream.js";
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
  let workspace: Workspace;
  let startupError: string | undefined;
  try {
    workspace = await resolveWorkspace(options.cwd);
  } catch (error) {
    workspace = { cwd: options.cwd };
    startupError = error instanceof Error ? error.message : "Workspace could not be resolved";
  }
  const connection = await resolveConnection(options.env);
  const controlPlane = connection.kind === "configured"
    ? await ensureLocalControlPlane({ apiUrl: connection.apiUrl, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) })
    : undefined;
  let session = await loadWorkspaceSession(workspace.cwd);
  const connectionReady = connection.kind === "configured" && controlPlane?.kind === "ready";
  let project = discoverWorkspaceProject(workspace.cwd, session);
  let client: ApiClient | undefined;
  if (connectionReady && connection.kind === "configured") {
    try {
      client = createApiClient({ baseUrl: connection.apiUrl, token: connection.token, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) });
    } catch {
      // The resolver already validates the endpoint. Keep the UI truthful if
      // a future client invariant rejects it at construction time.
      client = undefined;
    }
  }
  const state: TuiShellState = {
    workspace,
    connection: startupError !== undefined
      ? { kind: "error", message: `Workspace unavailable: ${startupError}` }
      : !connectionReady
      ? connection.kind !== "configured"
        ? { kind: "setup-required", message: connection.reason }
        : { kind: "error", message: controlPlane?.kind === "unavailable" ? controlPlane.reason : "Control Plane is not reachable" }
      : client === undefined
        ? { kind: "error", message: "Control Plane client could not be created" }
        : { kind: "connected" },
    goal: { kind: "empty" },
    workers: { kind: "empty" },
    approvals: { kind: "error", message: "Approval read surface is not available" },
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
    let recovery: RecoverySummary = reconcileTuiSession(workspace.cwd, session);
    let pendingConfirmation: { summary: CriticalActionSummary; resolve: (decision: ConfirmationResult) => void } | undefined;
    let activityStarted = false;
    let activityController: AbortController | undefined;
    const render = () => {
      const lines = [...renderShell(state, terminal.columns), "", ...renderRecoveryBanner(recovery, terminal.columns)];
      if (pendingConfirmation !== undefined) lines.push("", ...renderApprovalDialog(pendingConfirmation.summary, terminal.columns));
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
        recovery = reconcileTuiSession(workspace.cwd, session, { ...(dashboard.selectedGoal === undefined ? {} : { goalState: dashboard.selectedGoal.state }), ...(dashboard.workerCount === undefined ? {} : { activeWorkers: dashboard.workerCount }) });
        render();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Control Plane read failed";
        state.goal = { kind: "error", message };
        state.workers = { kind: "error", message };
        state.budget = { kind: "error", message };
        render();
      }
    };
    const streamActivity = async (signal: AbortSignal) => {
      const streamProject = project;
      if (client === undefined || streamProject.kind !== "attached") return;
      try {
        for await (const event of subscribeToEvents({
          client,
          projectId: streamProject.projectId,
          cursor: session?.lastEventCursor ?? "0",
          signal,
          maxReconnectAttempts: 5,
          onReconnect: (attempt, maxAttempts) => append(`Activity stream reconnecting (${attempt}/${maxAttempts})`),
        })) {
          if (signal.aborted) return;
          activity = mergeEvents(activity, [event]);
          const nextSession = advanceWorkspaceSession(workspace.cwd, session, event);
          session = nextSession;
          await saveWorkspaceSession(nextSession);
          render();
        }
        if (!signal.aborted) append("Activity stream unavailable: reconnect attempts exhausted");
      } catch (error) {
        if (!signal.aborted) append(`Activity stream unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    };
    const confirm = (summary: CriticalActionSummary): Promise<ConfirmationResult> => new Promise((resolveConfirmation) => {
      pendingConfirmation = { summary, resolve: resolveConfirmation };
      render();
    });
    const startActivity = () => {
      if (activityStarted || client === undefined || project.kind !== "attached") return;
      activityStarted = true;
      activityController = new AbortController();
      void streamActivity(activityController.signal);
    };
    const restartActivity = () => {
      activityController?.abort();
      activityStarted = false;
      activityController = undefined;
      startActivity();
    };
    const retryConnection = async () => {
      append("Retrying Maestro startup checks…");
      if (startupError !== undefined) {
        try {
          workspace = await resolveWorkspace(options.cwd);
          state.workspace = workspace;
          startupError = undefined;
        } catch (error) {
          startupError = error instanceof Error ? error.message : "Workspace could not be resolved";
          state.connection = { kind: "error", message: `Workspace unavailable: ${startupError}` };
          append(`Startup retry failed: ${startupError}`);
          return;
        }
      }
      if (connection.kind !== "configured") {
        state.connection = { kind: "setup-required", message: connection.reason };
        append(`Startup retry blocked: ${connection.reason}`);
        return;
      }
      const health = await ensureLocalControlPlane({ apiUrl: connection.apiUrl, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) });
      if (health.kind !== "ready") {
        state.connection = { kind: "error", message: health.reason };
        append(`Startup retry failed: ${health.reason}`);
        return;
      }
      try {
        client = createApiClient({ baseUrl: connection.apiUrl, token: connection.token, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) });
        project = discoverWorkspaceProject(workspace.cwd, session);
        state.connection = { kind: "connected" };
        recovery = reconcileTuiSession(workspace.cwd, session);
        append("Control Plane connected.");
        void refreshDashboard();
        restartActivity();
      } catch {
        client = undefined;
        state.connection = { kind: "error", message: "Control Plane client could not be created" };
        append("Startup retry failed: Control Plane client could not be created");
      }
    };
    const submit = async (text: string) => {
      try {
        const parsed = parseInput(text);
        if (parsed.kind === "command" && parsed.name === "session") {
          if (parsed.action === "retry") {
            await retryConnection();
          } else if (parsed.action === "new") {
            session = startNewConversationSession(workspace.cwd, session);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(workspace.cwd, session);
            append("New Concertmaster conversation started. Durable Goal state was preserved.");
          } else if (parsed.action === "attach") {
            const requestedProjectId = parsed.options["project-id"];
            const current = await loadWorkspaceSession(workspace.cwd);
            if (typeof requestedProjectId === "string" && requestedProjectId.trim() !== "") {
              session = attachWorkspaceSession(workspace.cwd, current, requestedProjectId);
              await saveWorkspaceSession(session);
            } else if (current !== undefined) {
              session = current;
            } else {
              append("Session attach requires --project-id when no workspace session is saved.");
              return;
            }
            project = discoverWorkspaceProject(workspace.cwd, session);
            recovery = reconcileTuiSession(workspace.cwd, session);
            append(renderRecoveryBanner(recovery, terminal.columns).join(" · "));
            void refreshDashboard();
            restartActivity();
          } else if (parsed.action === "list") {
            const current = await loadWorkspaceSession(workspace.cwd);
            append(current === undefined ? "Session: no saved workspace session" : renderRecoveryBanner(reconcileTuiSession(workspace.cwd, current), terminal.columns).join(" · "));
          } else {
            append(`Command: /session ${parsed.action ?? ""} (unknown session action)`.trim());
          }
        } else if (parsed.kind === "command" && client !== undefined && project.kind === "attached") {
          const action = registry.find(parsed.name)?.actions.find((item) => item.name === parsed.action);
          if (action?.kind === "read") {
            const readResult = await executeReadCommand({ client, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }) }, parsed);
            append(`${readResult.title}: ${readResult.lines.join(" · ")}`);
          } else if (action !== undefined) {
            const writeResult = await executeWriteCommand({ client, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }), confirm }, parsed);
            pendingConfirmation = undefined;
            append(`${writeResult.title}: ${writeResult.lines.join(" · ")}`);
            void refreshDashboard();
          } else {
            append(`Command: /${parsed.name}${parsed.action === undefined ? "" : ` ${parsed.action}`} (unknown command)`);
          }
        } else if (parsed.kind === "command") {
          append(`Command: /${parsed.name}${parsed.action === undefined ? "" : ` ${parsed.action}`} (unavailable until a workspace project is attached)`);
        } else {
          append(client === undefined ? `Concertmaster unavailable: ${state.connection.kind === "error" ? state.connection.message : "Control Plane client unavailable"}` : "Concertmaster conversation endpoint is not configured");
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
      pendingConfirmation?.resolve("cancelled");
      pendingConfirmation = undefined;
      activityController?.abort();
      tui.stop();
      resolve(0);
    };
    tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+k")) {
        append(`Commands: ${createCommandPalette().map((item) => `${item.label} [${item.description}]`).join(" · ")}`);
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+g")) {
        void submit("/goals list");
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+e")) {
        void submit("/events list");
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+r")) {
        void submit("/session retry");
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+c")) {
        stop();
        return { consume: true };
      }
      if (pendingConfirmation !== undefined && (data === "y" || data === "Y" || data === "n" || data === "N" || data === "\r" || data === "\u001b")) {
        const decision: ConfirmationResult = data === "y" || data === "Y" ? "approved" : "cancelled";
        const resolveConfirmation = pendingConfirmation.resolve;
        pendingConfirmation = undefined;
        resolveConfirmation(decision);
        render();
        return { consume: true };
      }
      return undefined;
    });
    const runtime = createTuiRuntime({ start: () => tui.start(), stop });
    runtime.start();
    void refreshDashboard();
    startActivity();
  });
}
