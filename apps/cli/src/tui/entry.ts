import {
  Box,
  CombinedAutocompleteProvider,
  Container,
  Editor,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
  type EditorTheme,
} from "@earendil-works/pi-tui";
import { createApiClient, type ApiClient, type GoalEvent } from "@maestro/api-client";
import { createTuiRuntime } from "./runtime.js";
import { resolveWorkspace, type Workspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { resolveLocalConnection } from "./local-bootstrap.js";
import { createCommandRegistry } from "./commands/registry.js";
import { createCommandAutocompleteItems } from "./commands/autocomplete.js";
import { createCommandPalette } from "./commands/palette.js";
import { parseInput } from "./commands/parser.js";
import {
  executeReadCommand,
  discoverWorkspaceProject,
  discoverWorkspaceProjectFromControlPlane,
  readDashboard,
} from "./commands/read-commands.js";
import { executeWriteCommand } from "./commands/write-commands.js";
import { renderApprovalDialog } from "./components/approval-dialog.js";
import { renderProviderLoginDialog, type AccountLoginProviderSelection } from "./components/provider-login-dialog.js";
import { reconcileTuiSession, type RecoverySummary } from "./recovery.js";
import { renderRecoveryBanner } from "./components/recovery-banner.js";
import type { CriticalActionSummary, ConfirmationResult } from "./confirmation.js";
import {
  advanceWorkspaceSession,
  attachWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
  selectWorkspaceGoal,
  selectWorkspaceModel,
  startNewConversationSession,
} from "./session.js";
import { mergeEvents, subscribeToEvents } from "./activity-stream.js";
import { renderActivityTimeline } from "./components/activity-timeline.js";
import { renderShell, renderTranscript, renderTuiFooter, type TuiShellState } from "./components/shell.js";
import { getModeAccentProgress, setModeAccentProgress, tuiTheme } from "./theme.js";
import type { CliIo } from "../main.js";
import { openExternalUrl } from "../external-url.js";

export interface InteractiveTuiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  io: CliIo;
}

const editorTheme: EditorTheme = {
  borderColor: tuiTheme.primary,
  selectList: {
    selectedPrefix: tuiTheme.primary,
    selectedText: tuiTheme.text,
    description: tuiTheme.muted,
    scrollInfo: tuiTheme.dim,
    noMatch: tuiTheme.warning,
  },
};

class MaestroEditor extends Editor {
  override render(width: number): string[] {
    const lines = super.render(width);
    // pi-tui 0.85 has no prompt-prefix option. Reserve two padding columns
    // and paint the prompt into them without moving the hardware cursor.
    if (lines.length > 2 && lines[1]!.startsWith("  ")) lines[1] = `${tuiTheme.primary("› ")}${lines[1]!.slice(2)}`;
    return lines;
  }
}

class SecretEditor extends MaestroEditor {
  hidden = false;

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!this.hidden) return lines;
    // Keep the editor frame and ANSI control sequences intact while replacing
    // only the content rows. The raw key remains in Editor state only until
    // submit and is never added to the normal prompt history.
    return lines.map((line, index) => index === 0 || index === lines.length - 1 ? line : maskVisibleText(line));
  }
}

function maskVisibleText(line: string): string {
  let masked = "";
  for (let index = 0; index < line.length;) {
    if (line[index] !== "\u001b") {
      const codePoint = line.codePointAt(index)!;
      masked += "•";
      index += codePoint > 0xffff ? 2 : 1;
      continue;
    }
    const start = index;
    index += 1;
    if (line[index] === "[" || line[index] === "]" || line[index] === "_") {
      index += 1;
      if (line[start + 1] === "[") {
        while (index < line.length && (line.charCodeAt(index) < 0x40 || line.charCodeAt(index) > 0x7e)) index += 1;
        if (index < line.length) index += 1;
      } else {
        while (index < line.length && line[index] !== "\u0007") index += 1;
        if (index < line.length) index += 1;
      }
    } else if (index < line.length) index += 1;
    masked += line.slice(start, index);
  }
  return masked;
}

/** Keeps the conversation area pinned above the input dock and footer. */
class FullHeightText {
  private readonly text = new Text("", 0, 0);
  private contentRenderer: () => string = () => "";

  setContentRenderer(renderer: () => string): void {
    this.contentRenderer = renderer;
  }

  render(width: number): string[] {
    // FullscreenViewport owns the available height and scroll position. Do
    // not pad this component: padding would create fake transcript rows and
    // make the viewport follow blank space instead of the latest message.
    this.text.setText(this.contentRenderer());
    return this.text.render(width);
  }

  invalidate(): void {
    this.text.invalidate();
  }
}

/** A quiet, terminal-native composer. It uses borders, not a forced surface colour. */
class FramedComposer {
  constructor(private readonly content: { render(width: number): string[]; invalidate(): void }) {}

  render(width: number): string[] {
    if (width < 2) return this.content.render(width);
    const innerWidth = width - 2;
    const lines = this.content.render(innerWidth);
    const top = tuiTheme.border(`╭${"─".repeat(Math.max(0, innerWidth - 2))}╮`);
    const bottom = tuiTheme.border(`╰${"─".repeat(Math.max(0, innerWidth - 2))}╯`);
    return [top, ...lines.map((line) => `${tuiTheme.border("│")}${line}${tuiTheme.border("│")}`), bottom];
  }

  invalidate(): void {
    this.content.invalidate();
  }
}

function shouldAutoBootstrapLocal(env: Record<string, string | undefined>): boolean {
  return (env.MAESTRO_API_URL?.trim() ?? "") === ""
    && (env.MAESTRO_API_TOKEN?.trim() ?? "") === ""
    && env.MAESTRO_DISABLE_LOCAL_AUTOSTART !== "true";
}

export async function startInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  let workspace: Workspace;
  let startupError: string | undefined;
  try {
    workspace = await resolveWorkspace(options.cwd);
  } catch (error) {
    workspace = { cwd: options.cwd };
    startupError = error instanceof Error ? error.message : "Workspace could not be resolved";
  }
  let connection = await resolveConnection(options.env);
  if (connection.kind !== "configured" && shouldAutoBootstrapLocal(options.env)) {
    connection = await resolveLocalConnection({
      env: options.env,
      ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
    });
  }
  const controlPlane =
    connection.kind === "configured"
      ? await ensureLocalControlPlane({ apiUrl: connection.apiUrl, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) })
      : undefined;
  let session = await loadWorkspaceSession(workspace.cwd);
  const connectionReady = connection.kind === "configured" && controlPlane?.kind === "ready";
  let project = discoverWorkspaceProject(workspace.cwd, session);
  let projectDiscoveryNotice: string | undefined;
  let client: ApiClient | undefined;
  if (connectionReady && connection.kind === "configured") {
    try {
      client = createApiClient({
        baseUrl: connection.apiUrl,
        token: connection.token,
        ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
      });
      const previousProject = project;
      const discovered = await discoverWorkspaceProjectFromControlPlane({ workspacePath: workspace.cwd, session, client });
      project = discovered;
      if (discovered.kind === "attached") {
        if (previousProject.kind !== "attached" || previousProject.projectId !== discovered.projectId) {
          session = attachWorkspaceSession(workspace.cwd, session, discovered.projectId);
          await saveWorkspaceSession(session);
        }
      } else {
        projectDiscoveryNotice = discovered.reason;
      }
    } catch {
      // The resolver already validates the endpoint. Keep the UI truthful if
      // a future client invariant rejects it at construction time.
      client = undefined;
    }
  }
  const initialModel = options.env.MAESTRO_MODEL?.trim() || session?.model;
  const state: TuiShellState = {
    workspace,
    ...(initialModel === undefined ? {} : { model: initialModel }),
    mode: "maestro",
    connection:
      startupError !== undefined
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
    const editor = new SecretEditor(tui, editorTheme, { paddingX: 2, autocompleteMaxVisible: 6 });
    const inputPanel = new Box(1, 0, tuiTheme.inputSurface);
    inputPanel.addChild(
      new Text(`${tuiTheme.muted("message to Concertmaster")} ${tuiTheme.border("·")} ${tuiTheme.dim("Enter to send")}`, 0, 0),
    );
    inputPanel.addChild(editor);
    const composer = new FramedComposer(inputPanel);
    const footer = new Text("", 0, 0);
    const header = new FullHeightText();
    const registry = createCommandRegistry();
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        createCommandAutocompleteItems(registry),
        workspace.cwd,
      ),
    );
    let transcript: string[] = [];
    let activity: GoalEvent[] = [];
    let recovery: RecoverySummary = reconcileTuiSession(workspace.cwd, session);
    let pendingConfirmation: { summary: CriticalActionSummary; resolve: (decision: ConfirmationResult) => void } | undefined;
    let activityStarted = false;
    let activityController: AbortController | undefined;
    let conversationTurnController: AbortController | undefined;
    let pendingProviderLogin: "openai" | "anthropic" | undefined;
    let accountLoginSelection: AccountLoginProviderSelection | undefined;
    let accountLoginState: "selecting" | "opening" | "waiting" | undefined;
    let accountLoginController: AbortController | undefined;
    let accountLoginId: string | undefined;
    const syncModelState = (): void => {
      const model = options.env.MAESTRO_MODEL?.trim() || session?.model;
      if (model === undefined) delete state.model;
      else state.model = model;
    };
    header.setContentRenderer(() => {
      const lines = [...renderShell(state, terminal.columns, terminal.rows), "", ...renderRecoveryBanner(recovery, terminal.columns)];
      if (pendingConfirmation !== undefined) lines.push("", ...renderApprovalDialog(pendingConfirmation.summary, terminal.columns));
      if (activity.length > 0) lines.push("", "Activity", ...renderActivityTimeline(activity, terminal.columns));
      if (transcript.length > 0) lines.push("", ...renderTranscript(transcript, terminal.columns));
      return lines.join("\n");
    });
    const render = () => {
      footer.setText(renderTuiFooter(terminal.columns));
      tui.requestRender(true);
    };
    const append = (line: string) => {
      transcript = [...transcript.slice(-40), line];
      render();
    };
    let flashmobMode = false;
    let flashmobAnimationId = 0;
    const animateFlashmobMode = async (enabled: boolean): Promise<void> => {
      const animationId = ++flashmobAnimationId;
      const from = getModeAccentProgress();
      const to = enabled ? 1 : 0;
      flashmobMode = enabled;
      state.mode = enabled ? "flashmob" : "maestro";
      const steps = 12;
      for (let step = 1; step <= steps; step += 1) {
        if (animationId !== flashmobAnimationId) return;
        setModeAccentProgress(from + ((to - from) * step) / steps);
        render();
        await new Promise<void>((resolveFrame) => setTimeout(resolveFrame, 18));
      }
      if (animationId !== flashmobAnimationId) return;
      setModeAccentProgress(to);
      render();
      append(`Flashmob ${enabled ? "enabled" : "disabled"} · ${enabled ? "blue" : "Warm Earth"} accent`);
    };
    const refreshDashboard = async () => {
      if (client === undefined || project.kind !== "attached") return;
      state.goal = { kind: "loading" };
      state.workers = { kind: "loading" };
      state.budget = { kind: "loading" };
      render();
      try {
        const dashboard = await readDashboard({
          client,
          projectId: project.projectId,
          ...(session?.goalId === undefined ? {} : { goalId: session.goalId }),
        });
        state.goal =
          dashboard.selectedGoal === undefined
            ? { kind: "empty" }
            : { kind: "value", value: { name: dashboard.selectedGoal.goalId, state: dashboard.selectedGoal.state } };
        state.workers = dashboard.workerCount === undefined ? { kind: "empty" } : { kind: "value", value: dashboard.workerCount };
        state.budget =
          dashboard.budget === undefined
            ? { kind: "empty" }
            : { kind: "value", value: { spentCents: dashboard.budget.costCents, ceilingCents: dashboard.budget.budgetCents } };
        recovery = reconcileTuiSession(workspace.cwd, session, {
          ...(dashboard.selectedGoal === undefined ? {} : { goalState: dashboard.selectedGoal.state }),
          ...(dashboard.workerCount === undefined ? {} : { activeWorkers: dashboard.workerCount }),
        });
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
    const confirm = (summary: CriticalActionSummary): Promise<ConfirmationResult> =>
      new Promise((resolveConfirmation) => {
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
        if (shouldAutoBootstrapLocal(options.env)) {
          connection = await resolveLocalConnection({
            env: options.env,
            ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
          });
          if (connection.kind !== "configured") {
            state.connection = { kind: "setup-required", message: connection.reason };
            append(`Startup retry blocked: ${connection.reason}`);
            return;
          }
        } else {
          state.connection = { kind: "setup-required", message: connection.reason };
          append(`Startup retry blocked: ${connection.reason}`);
          return;
        }
      }
      const health = await ensureLocalControlPlane({
        apiUrl: connection.apiUrl,
        ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
      });
      if (health.kind !== "ready") {
        state.connection = { kind: "error", message: health.reason };
        append(`Startup retry failed: ${health.reason}`);
        return;
      }
      try {
        client = createApiClient({
          baseUrl: connection.apiUrl,
          token: connection.token,
          ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
        });
        project = discoverWorkspaceProject(workspace.cwd, session);
        projectDiscoveryNotice = undefined;
        const previousProject = project;
        const discovered = await discoverWorkspaceProjectFromControlPlane({ workspacePath: workspace.cwd, session, client });
        project = discovered;
        if (discovered.kind === "attached") {
          if (previousProject.kind !== "attached" || previousProject.projectId !== discovered.projectId) {
            session = attachWorkspaceSession(workspace.cwd, session, discovered.projectId);
            syncModelState();
            await saveWorkspaceSession(session);
          }
        } else {
          projectDiscoveryNotice = discovered.reason;
        }
        state.connection = { kind: "connected" };
        recovery = reconcileTuiSession(workspace.cwd, session);
        append("Control Plane connected.");
        if (projectDiscoveryNotice !== undefined) append(projectDiscoveryNotice);
        void refreshDashboard();
        restartActivity();
      } catch {
        client = undefined;
        state.connection = { kind: "error", message: "Control Plane client could not be created" };
        append("Startup retry failed: Control Plane client could not be created");
      }
    };
    const cancelAccountLogin = (): void => {
      const controller = accountLoginController;
      accountLoginController = undefined;
      const loginId = accountLoginId;
      accountLoginId = undefined;
      accountLoginSelection = undefined;
      accountLoginState = undefined;
      editor.hidden = false;
      editor.setText("");
      controller?.abort();
      if (loginId !== undefined && client !== undefined) void client.cancelAccountLogin(loginId).catch(() => undefined);
      render();
    };
    const startAccountLogin = async (): Promise<void> => {
      if (client === undefined) { append("Account login is unavailable until the Control Plane is connected."); cancelAccountLogin(); return; }
      if (accountLoginSelection === 1) { append("Claude Pro / Max account login is unavailable until Anthropic approves a public OAuth integration."); cancelAccountLogin(); return; }
      accountLoginState = "opening";
      render();
      const controller = new AbortController();
      accountLoginController = controller;
      try {
        const login = await client.startAccountLogin();
        accountLoginId = login.loginId;
        if (controller.signal.aborted) return;
        accountLoginState = "waiting";
        render();
        try { await (options.io.openExternalUrl ?? openExternalUrl)(login.authUrl); }
        catch { append(`Open this URL in your browser to sign in: ${login.authUrl}`); }
        const timeoutMs = Number(options.env.MAESTRO_LOGIN_TIMEOUT_MS ?? "120000");
        const pollMs = Number(options.env.MAESTRO_LOGIN_POLL_MS ?? "500");
        const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
        let status = await client.accountLoginStatus(login.loginId);
        while (status.state === "pending" && Date.now() < deadline && !controller.signal.aborted) {
          await new Promise<void>((resolveFrame) => setTimeout(resolveFrame, Number.isFinite(pollMs) && pollMs >= 0 ? pollMs : 500));
          status = await client.accountLoginStatus(login.loginId);
        }
        if (controller.signal.aborted) return;
        if (status.state === "succeeded") { append("Account login complete: openai-codex"); void refreshDashboard(); }
        else append(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
      } catch (error) { if (!controller.signal.aborted) append(`Account login failed: ${error instanceof Error ? error.message : "request failed"}`); }
      finally { if (accountLoginController === controller) { accountLoginController = undefined; accountLoginId = undefined; accountLoginSelection = undefined; accountLoginState = undefined; editor.hidden = false; render(); } }
    };

    const submit = async (text: string) => {
      if (pendingProviderLogin !== undefined) {
        const providerId = pendingProviderLogin;
        pendingProviderLogin = undefined;
        editor.hidden = false;
        editor.setText("");
        if (client === undefined) {
          append("Provider login is unavailable until the Control Plane is connected.");
          return;
        }
        try {
          await client.loginProvider({ providerId, authMode: "api-key", secret: text });
          append(`Provider login complete: ${providerId} API key stored by the model gateway.`);
        } catch (error) {
          append(`Provider login failed: ${error instanceof Error ? error.message : "request failed"}`);
        }
        return;
      }
      try {
        const parsed = parseInput(text);
        if (parsed.kind === "command" && parsed.name === "help") {
          append(`Commands: ${createCommandPalette().map((item) => `${item.label} [${item.description}]`).join(" · ")}`);
        } else if (parsed.kind === "command" && parsed.name === "login" && parsed.action === undefined) {
          accountLoginSelection = 0;
          accountLoginState = "selecting";
          editor.hidden = true;
          editor.setText("");
          render();
        } else if (parsed.kind === "command" && parsed.name === "login" && parsed.action === "openai-codex") {
          accountLoginSelection = 0;
          accountLoginState = "selecting";
          editor.hidden = true;
          editor.setText("");
          render();
          void startAccountLogin();
        } else if (parsed.kind === "command" && parsed.name === "login" && (parsed.action === "openai" || parsed.action === "anthropic")) {
          if (client === undefined) {
            append("Provider login is unavailable until the Control Plane is connected.");
          } else {
            pendingProviderLogin = parsed.action;
            editor.hidden = true;
            editor.setText("");
            append(`Enter the ${parsed.action} API key and press Enter. Input is hidden and never saved to session history.`);
            render();
          }
        } else if (parsed.kind === "command" && parsed.name === "logout" && parsed.action === "openai-codex") {
          if (client === undefined) append("Account logout is unavailable until the Control Plane is connected.");
          else {
            await client.logoutAccount();
            append("ChatGPT account signed out; its model bindings were revoked.");
            void refreshDashboard();
          }
        } else if (parsed.kind === "command" && parsed.name === "logout" && (parsed.action === "openai" || parsed.action === "anthropic")) {
          if (client === undefined) append("Provider logout is unavailable until the Control Plane is connected.");
          else {
            await client.logoutProvider(parsed.action);
            append(`Provider credential revoked: ${parsed.action}.`);
          }
        } else if (parsed.kind === "command" && parsed.name === "flashmob" && (parsed.action === undefined || parsed.action === "toggle")) {
          await animateFlashmobMode(!flashmobMode);
        } else if (parsed.kind === "command" && parsed.name === "mode" && (parsed.action === undefined || parsed.action === "list")) {
          append(`Mode: ${flashmobMode ? "flashmob" : "maestro"} · use /mode flashmob, /mode maestro, or /flashmob to toggle`);
        } else if (parsed.kind === "command" && parsed.name === "mode" && parsed.action === "flashmob") {
          await animateFlashmobMode(true);
        } else if (parsed.kind === "command" && parsed.name === "mode" && (parsed.action === "maestro" || parsed.action === "standard")) {
          await animateFlashmobMode(false);
        } else if (parsed.kind === "command" && parsed.name === "session") {
          if (parsed.action === "retry") {
            await retryConnection();
          } else if (parsed.action === "new") {
            session = startNewConversationSession(workspace.cwd, session);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(workspace.cwd, session);
            append("New Concertmaster conversation started. Durable Goal state was preserved.");
          } else if (parsed.action === "attach") {
            const requestedProjectId = parsed.options["project-id"];
            const requestedProjectIndex = parsed.options["project-index"];
            const current = await loadWorkspaceSession(workspace.cwd);
            if (typeof requestedProjectId === "string" && requestedProjectId.trim() !== "") {
              session = attachWorkspaceSession(workspace.cwd, current, requestedProjectId);
              syncModelState();
              await saveWorkspaceSession(session);
            } else if (typeof requestedProjectIndex === "string" && requestedProjectIndex.trim() !== "") {
              if (client === undefined) {
                append("Project discovery is unavailable until the Control Plane is connected.");
                return;
              }
              const index = Number(requestedProjectIndex);
              const projects = (await client.listProjects()).projects;
              if (!Number.isSafeInteger(index) || index < 1 || index > projects.length) {
                append(`Project index must be a number from 1 to ${projects.length}.`);
                return;
              }
              session = attachWorkspaceSession(workspace.cwd, current, projects[index - 1]!);
              syncModelState();
              await saveWorkspaceSession(session);
            } else if (current?.projectId !== undefined) {
              session = current;
              syncModelState();
            } else if (client !== undefined) {
              const discovered = await discoverWorkspaceProjectFromControlPlane({ workspacePath: workspace.cwd, session: current, client });
              if (discovered.kind !== "attached") {
                append(discovered.reason);
                return;
              }
              session = attachWorkspaceSession(workspace.cwd, current, discovered.projectId);
              syncModelState();
              await saveWorkspaceSession(session);
            } else {
              append("Session attach requires a connected Control Plane or --project-id.");
              return;
            }
            project = discoverWorkspaceProject(workspace.cwd, session);
            projectDiscoveryNotice = undefined;
            recovery = reconcileTuiSession(workspace.cwd, session);
            append(renderRecoveryBanner(recovery, terminal.columns).join(" · "));
            void refreshDashboard();
            restartActivity();
          } else if (parsed.action === "list") {
            const current = await loadWorkspaceSession(workspace.cwd);
            append(
              current === undefined
                ? "Session: no saved workspace session"
                : renderRecoveryBanner(reconcileTuiSession(workspace.cwd, current), terminal.columns).join(" · "),
            );
          } else {
            append(`Command: /session ${parsed.action ?? ""} (unknown session action)`.trim());
          }
        } else if (parsed.kind === "command" && parsed.name === "goal" && parsed.action === "select") {
          const requestedGoalId = parsed.options["goal-id"];
          if (client === undefined || project.kind !== "attached") {
            append("Goal selection is unavailable until a workspace project is attached.");
          } else if (typeof requestedGoalId !== "string" || requestedGoalId.trim() === "") {
            append("Goal selection requires --goal-id.");
          } else {
            const selected = await client.getGoal(requestedGoalId, { projectId: project.projectId });
            if (selected.projectId !== project.projectId) throw new Error("Selected Goal is bound to another project");
            const current = await loadWorkspaceSession(workspace.cwd);
            session = selectWorkspaceGoal(workspace.cwd, current ?? session, selected.goalId);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(workspace.cwd, session, { goalState: selected.state });
            append(`Selected Goal: ${selected.goalId} · ${selected.state} · v${selected.version}`);
            void refreshDashboard();
          }
        } else if (parsed.kind === "command" && parsed.name === "projects" && parsed.action === "list") {
          if (client === undefined) {
            append("Projects unavailable until the Control Plane is connected.");
          } else {
            const readResult = await executeReadCommand(
              { client, projectId: project.kind === "attached" ? project.projectId : "" },
              parsed,
            );
            append(`${readResult.title}: ${readResult.lines.join(" · ")}`);
          }
        } else if (parsed.kind === "command" && (parsed.name === "models" || parsed.name === "model") && (parsed.action === undefined || parsed.action === "list")) {
          if (client === undefined) append("Model catalog unavailable until the Control Plane is connected.");
          else {
            const models = await client.listModels();
            append(
              models.length === 0
                ? "No models are currently available."
                : `Models: ${models.map((model) => `${model.identity.provider}/${model.identity.id}`).join(" · ")}`,
            );
          }
        } else if (parsed.kind === "command" && (parsed.name === "models" || parsed.name === "model") && parsed.action === "use") {
          const requestedModel = parsed.options["model"];
          if (client === undefined) {
            append("Model selection is unavailable until the Control Plane is connected.");
          } else if (typeof requestedModel !== "string" || requestedModel.trim() === "") {
            append("Model selection requires --model provider/model (use /model list first).");
          } else {
            const models = await client.listModels();
            const selected = models.find((model) => `${model.identity.provider}/${model.identity.id}` === requestedModel);
            if (selected === undefined) {
              append(`Model is not available: ${requestedModel}`);
            } else if (session?.conversationId !== undefined) {
              append("The active conversation is bound to its model. Use /session new before selecting another model.");
            } else {
              session = selectWorkspaceModel(workspace.cwd, session, requestedModel);
              await saveWorkspaceSession(session);
              state.model = requestedModel;
              append(`Selected model: ${requestedModel}`);
            }
          }
        } else if (parsed.kind === "command" && parsed.name === "conversation" && parsed.action === "cancel") {
          if (client === undefined || project.kind !== "attached" || session?.conversationId === undefined)
            append("No active conversation is available to cancel.");
          else {
            conversationTurnController?.abort();
            const cancelled = await client.cancelConversation(session.conversationId, { projectId: project.projectId });
            append(`Conversation ${cancelled.conversationId}: ${cancelled.status}`);
          }
        } else if (parsed.kind === "command" && client !== undefined && project.kind === "attached") {
          const action = registry.find(parsed.name)?.actions.find((item) => item.name === parsed.action);
          if (action?.kind === "read") {
            const readResult = await executeReadCommand(
              { client, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }) },
              parsed,
            );
            append(`${readResult.title}: ${readResult.lines.join(" · ")}`);
          } else if (action !== undefined) {
            const writeResult = await executeWriteCommand(
              { client, projectId: project.projectId, ...(session?.goalId === undefined ? {} : { goalId: session.goalId }), confirm },
              parsed,
            );
            pendingConfirmation = undefined;
            append(`${writeResult.title}: ${writeResult.lines.join(" · ")}`);
            void refreshDashboard();
          } else {
            const definition = registry.find(parsed.name);
            append(
              definition === undefined
                ? `Unknown command: /${parsed.name}. Use /help for available commands.`
                : `Command /${parsed.name} requires an action: ${definition.actions.map((item) => item.name).join(", ")}`,
            );
          }
        } else if (parsed.kind === "command") {
          append(
            `Command: /${parsed.name}${parsed.action === undefined ? "" : ` ${parsed.action}`} (unavailable until a workspace project is attached)`,
          );
        } else {
          if (client === undefined) {
            append(
              `Concertmaster unavailable: ${state.connection.kind === "error" ? state.connection.message : "Control Plane client unavailable"}`,
            );
          } else if (project.kind !== "attached") {
            append("Concertmaster requires an attached workspace project.");
          } else if (flashmobMode) {
            append(
              "Flashmob is a planned bounded fast path, but its Vanguard runtime is not wired yet. Switch to /mode maestro for governed conversation.",
            );
          } else if (session?.goalId === undefined) {
            append("Select a Goal before sending a Concertmaster message (use /goal select --goal-id <id>).");
          } else {
            const configuredModel = options.env.MAESTRO_MODEL?.trim() || session.model;
            if (session.conversationId === undefined && configuredModel === undefined) {
              append(
                "No model selected. Set MAESTRO_MODEL to an exact provider/model (for example openai/gpt-5), then start a new session.",
              );
            } else {
              if (session.conversationId === undefined) {
                const created = await client.createConversation({
                  projectId: project.projectId,
                  goalId: session.goalId,
                  model: configuredModel!,
                });
                session = {
                  workspacePath: workspace.cwd,
                  projectId: project.projectId,
                  goalId: session.goalId,
                  ...(session.lastEventCursor === undefined ? {} : { lastEventCursor: session.lastEventCursor }),
                  conversationId: created.conversationId,
                  model: created.model,
                };
                state.model = created.model;
                await saveWorkspaceSession(session);
                append(`Concertmaster conversation ${created.conversationId} · ${created.model}`);
              }
              const activeConversationId = session.conversationId;
              if (activeConversationId === undefined) throw new Error("Conversation was not created");
              const turnController = new AbortController();
              conversationTurnController = turnController;
              try {
                const result = await client.sendConversationTurn(
                  activeConversationId,
                  { projectId: project.projectId, text },
                  { signal: turnController.signal },
                );
                append(`Maestro [${result.conversation.status}]: ${result.turn.content}`);
              } finally {
                if (conversationTurnController === turnController) conversationTurnController = undefined;
              }
            }
          }
        }
      } catch (error) {
        append(`Input error: ${error instanceof Error ? error.message : "invalid input"}`);
      }
      editor.addToHistory(text);
    };
    editor.onSubmit = (text) => {
      void submit(text);
    };
    // The explicit alternate-screen layout gives the transcript a constrained,
    // independently scrollable region and keeps the composer/footer pinned.
    const transcriptView = new ScrollView(header, { follow: "end", primary: true, overscroll: "chain", scrollbar: "auto" });
    const dock = new VStack([composer, footer]);
    tui.setLayoutRoot(new VStack([
      { component: transcriptView, basis: 0, grow: 1, minSize: 1 },
      { component: dock, basis: "auto", shrink: 1, minSize: 1 },
    ]));
    tui.setFocus(editor);
    render();

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      pendingConfirmation?.resolve("cancelled");
      pendingConfirmation = undefined;
      activityController?.abort();
      conversationTurnController?.abort();
      accountLoginController?.abort();
      if (accountLoginId !== undefined && client !== undefined) void client.cancelAccountLogin(accountLoginId).catch(() => undefined);
      flashmobAnimationId += 1;
      tui.stop();
      resolve(0);
    };
    tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+k")) {
        append(
          `Commands: ${createCommandPalette()
            .map((item) => `${item.label} [${item.description}]`)
            .join(" · ")}`,
        );
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
        if (conversationTurnController !== undefined) {
          conversationTurnController.abort();
          append("Cancelling the active conversation turn…");
          if (client !== undefined && project.kind === "attached" && session?.conversationId !== undefined) {
            void client
              .cancelConversation(session.conversationId, { projectId: project.projectId })
              .then((cancelled) => append(`Conversation ${cancelled.conversationId}: ${cancelled.status}`))
              .catch((error) =>
                append(`Conversation cancellation unavailable: ${error instanceof Error ? error.message : "unknown error"}`),
              );
          }
          return { consume: true };
        }
        stop();
        return { consume: true };
      }
      if (accountLoginSelection !== undefined && accountLoginState === "selecting") {
        if (matchesKey(data, "up") || matchesKey(data, "down")) {
          accountLoginSelection = accountLoginSelection === 0 ? 1 : 0;
          render();
          return { consume: true };
        }
        if (matchesKey(data, "escape")) { cancelAccountLogin(); return { consume: true }; }
        if (matchesKey(data, "enter")) { void startAccountLogin(); return { consume: true }; }
        return { consume: true };
      }
      if (accountLoginSelection !== undefined && accountLoginState === "waiting" && matchesKey(data, "escape")) {
        cancelAccountLogin();
        append("Account login cancelled.");
        return { consume: true };
      }
      if (
        pendingConfirmation !== undefined &&
        (data === "y" || data === "Y" || data === "n" || data === "N" || data === "\r" || data === "\u001b")
      ) {
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
    if (projectDiscoveryNotice !== undefined) append(projectDiscoveryNotice);
    void refreshDashboard();
    startActivity();
  });
}
