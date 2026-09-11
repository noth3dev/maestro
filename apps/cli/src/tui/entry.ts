import { randomUUID } from "node:crypto";
import {
  Box,
  CombinedAutocompleteProvider,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
} from "@earendil-works/pi-tui";
import { createApiClient, type GoalEvent } from "@maestro/api-client";
import type { ConversationEvent } from "@maestro/contracts";

import { resolveWorkspace } from "./workspace.js";

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
import { nextApprovalDialogScope, type ApprovalDialogSummary, type CriticalActionSummary, type ConfirmationResult } from "./confirmation.js";
import {
  advanceWorkspaceSession,
  attachWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
  selectWorkspaceGoal,
  selectWorkspaceModel,
  startNewConversationSession,
} from "./session.js";
import { mergeEvents, runActivityStream, subscribeToEvents } from "./activity-stream.js";
import { addConversationMessage, applyConversationEvent, createConversationTranscript, isTerminalConversationEvent, renderUnifiedStreamEntries, type ConversationTranscriptState } from "./conversation-transcript.js";
import { pendingDecisionsFromActivity, toActivityTimelineEvent } from "./components/activity-timeline.js";
import { createDecisionRegion, createDynamicRegion, createStatusRegion } from "./components/regions.js";
import { createSplashController, renderPendingDecisionDetails, renderTuiFooter } from "./components/shell.js";
import { getModeAccentProgress, setModeAccentProgress, tuiTheme, type TranscriptLine } from "./theme.js";

import { copyToClipboard, openExternalUrl } from "../external-url.js";
import { editorTheme, SecretEditor } from "./components/editors.js";
import { ConversationViewport, FramedComposer } from "./components/conversation-viewport.js";

export { type InteractiveTuiOptions } from "./startup.js";
import { initializeTui, shouldAutoBootstrapLocal, type InteractiveTuiOptions } from "./startup.js";
import { createTuiRuntime } from "./runtime.js";

export async function startInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  const initialized = await initializeTui(options);
  let { workspace, startupError, connection, session, project, projectDiscoveryNotice, client } = initialized;
  const { state } = initialized;
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
    const header = new ConversationViewport();
    const registry = createCommandRegistry();
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        createCommandAutocompleteItems(registry),
        workspace.cwd,
      ),
    );
    let conversation: ConversationTranscriptState = createConversationTranscript();
    let activity: GoalEvent[] = [];
    const splash = createSplashController();
    let recovery: RecoverySummary = reconcileTuiSession(workspace.cwd, session);
    let pendingConfirmation: { summary: ApprovalDialogSummary; resolve: (decision: ConfirmationResult) => void } | undefined;
    const syncPendingDecisionState = (): void => {
      const goalId = session?.goalId ?? (state.goal.kind === "value" ? state.goal.value.name : undefined);
      const scopedActivity = goalId === undefined ? [] : activity.filter((event) => event.goalId === goalId).map(toActivityTimelineEvent);
      const decisions = pendingDecisionsFromActivity(scopedActivity);
      if (pendingConfirmation !== undefined) {
        const summary = pendingConfirmation.summary;
        const identity = summary.identity?.trim();
        const actor = summary.actor?.trim();
        const tier = summary.tier === "user" ? "You" : summary.tier;
        if (identity !== undefined && identity !== "" && actor !== undefined && actor !== "" && tier !== undefined) {
          decisions.unshift({ identity, tier, action: `${summary.action} ${summary.target}`, actor });
        }
      }
      state.pendingDecisions = decisions;
    };
    let activityStarted = false;
    let activityHydrationGeneration = 0;
    let activityController: AbortController | undefined;
    let conversationTurnController: AbortController | undefined;
    let pendingProviderLogin: "openai" | "anthropic" | undefined;
    let accountLoginSelection: AccountLoginProviderSelection | undefined;
    let accountLoginState: "selecting" | "opening" | "waiting" | undefined;
    let accountLoginController: AbortController | undefined;
    let accountLoginId: string | undefined;
    let accountLoginUrl: string | undefined;
    const syncModelState = (): void => {
      const model = options.env.MAESTRO_MODEL?.trim() || session?.model;
      if (model === undefined) delete state.model;
      else state.model = model;
    };
    const statusRegion = createStatusRegion({ state, height: () => terminal.rows, splash });
    const decisionRegion = createDecisionRegion({ state, height: () => terminal.rows });
    const noticeRegion = createDynamicRegion(() => {
      if (terminal.rows < 16) return [];
      const lines = [...renderRecoveryBanner(recovery, terminal.columns)];
      if (accountLoginSelection !== undefined && accountLoginState !== undefined) lines.push(...renderProviderLoginDialog(terminal.columns, accountLoginSelection, accountLoginState, accountLoginUrl));
      return lines;
    });
    header.setOrderedStreamRenderer(() => renderUnifiedStreamEntries(conversation, activity, terminal.columns));
    const render = () => {
      syncPendingDecisionState();
      footer.setText(terminal.rows < 16 ? "" : renderTuiFooter(terminal.columns, state));
      tui.requestRender(true);
    };
    const append = (line: string | TranscriptLine) => {
      splash.dismiss();
      const semanticLine: TranscriptLine = typeof line === "string" ? { kind: "system", text: line } : line;
      const next = addConversationMessage(conversation, "system", semanticLine.text, semanticLine.kind);
      conversation = { ...next, messages: next.messages.slice(-80) };
      render();
    };
    const appendError = (text: string): void => append({ kind: "error", text });
    const appendSuccess = (text: string): void => append({ kind: "success", text });
    const appendWarning = (text: string): void => append({ kind: "warning", text });
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
      appendSuccess(`Flashmob ${enabled ? "enabled" : "disabled"} · ${enabled ? "blue" : "Warm Earth"} accent`);
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
    const hydrateActivity = async (projectId: string, generation: number): Promise<void> => {
      if (client === undefined) return;
      try {
        let cursor = "0";
        const history: GoalEvent[] = [];
        for (let page = 0; page < 64; page += 1) {
          const result = await client.listEvents({ projectId, after: cursor });
          if (generation !== activityHydrationGeneration || project.kind !== "attached" || project.projectId !== projectId) return;
          history.push(...result.events);
          if (result.events.length === 0 || result.nextCursor === cursor || result.events.length < 100) break;
          cursor = result.nextCursor;
        }
        if (generation !== activityHydrationGeneration || project.kind !== "attached" || project.projectId !== projectId) return;
        activity = mergeEvents(activity, history);
        render();
      } catch (error) {
        if (generation === activityHydrationGeneration && project.kind === "attached" && project.projectId === projectId) {
          appendWarning(`Activity history unavailable: ${error instanceof Error ? error.message : "Control Plane request failed"}`);
        }
      }
    };

    const streamActivity = async (signal: AbortSignal, projectId: string, generation: number) => {
      if (client === undefined) return;
      await runActivityStream({
        client,
        projectId,
        cursor: activity.at(-1)?.cursor ?? session?.lastEventCursor ?? "0",
        signal,
        maxReconnectAttempts: 5,
        onReconnect: (attempt, maxAttempts) => append({ kind: "warning", text: `Activity stream reconnecting (${attempt}/${maxAttempts})` }),
        onEvent: async (event) => {
          if (generation !== activityHydrationGeneration || project.kind !== "attached" || project.projectId !== projectId) return;
          activity = mergeEvents(activity, [event]);
          splash.dismiss();
          const nextSession = advanceWorkspaceSession(workspace.cwd, session, event);
          if (generation !== activityHydrationGeneration || project.kind !== "attached" || project.projectId !== projectId) return;
          await saveWorkspaceSession(nextSession);
          if (generation !== activityHydrationGeneration || project.kind !== "attached" || project.projectId !== projectId) return;
          session = nextSession;
          render();
        },
        onUnavailable: (message) => append(message),
        onFailure: (message) => append(message),
      });
    };

    let conversationStreamController: AbortController | undefined;
    let conversationHydration: Promise<void> = Promise.resolve();
    let conversationHydrationGeneration = 0;
    const streamConversation = async (conversationId: string, projectId: string, controller: AbortController): Promise<void> => {
      if (client === undefined) return;
      const signal = controller.signal;
      try {
        const streamClient = {
          streamEvents: (query: { projectId: string; after: string }, streamOptions: { signal: AbortSignal }) =>
            client!.streamConversationEvents(conversationId, query, streamOptions),
        };
        for await (const event of subscribeToEvents({
          client: streamClient,
          projectId,
          cursor: conversation.lastCursor,
          signal,
          maxReconnectAttempts: 5,
          onReconnect: (attempt, maxAttempts) => append({ kind: "warning", text: `Conversation stream reconnecting (${attempt}/${maxAttempts})` }),
        })) {
          if (signal.aborted || session?.conversationId !== conversationId || project.kind !== "attached" || project.projectId !== projectId) return;
          conversation = applyConversationEvent(conversation, event);
          splash.dismiss();
          render();
          if (isTerminalConversationEvent(conversation, event)) {
            if (!signal.aborted) controller.abort();
            return;
          }
        }
        if (!signal.aborted) appendError("Conversation stream unavailable: reconnect attempts exhausted");
      } catch (error) {
        if (!signal.aborted) appendError(`Conversation stream unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    };

    const hydrateConversation = async (conversationId: string | undefined, projectId: string, generation: number): Promise<void> => {
      if (client === undefined || conversationId === undefined) return;
      try {
        let hydrated = createConversationTranscript();
        let cursor = "0";
        for (let page = 0; page < 64; page += 1) {
          const events = await client.listConversationEvents(conversationId, { projectId, after: cursor });
          if (generation !== conversationHydrationGeneration || session?.conversationId !== conversationId || project.kind !== "attached" || project.projectId !== projectId) return;
          for (const event of events) hydrated = applyConversationEvent(hydrated, event);
          const nextCursor = events.at(-1)?.cursor;
          if (nextCursor === undefined || events.length < 256) break;
          cursor = nextCursor;
        }
        if (generation !== conversationHydrationGeneration || session?.conversationId !== conversationId || project.kind !== "attached" || project.projectId !== projectId) return;
        conversation = hydrated;
        splash.dismiss();
        render();
      } catch (error) {
        if (generation === conversationHydrationGeneration) appendError(`Conversation history unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    };

    const confirm = (summary: CriticalActionSummary): Promise<ConfirmationResult> =>
      new Promise((resolveConfirmation) => {
        pendingConfirmation = { summary, resolve: resolveConfirmation };
        syncPendingDecisionState();
        render();
      });
    const startActivity = () => {
      if (activityStarted || client === undefined || project.kind !== "attached") return;
      const projectId = project.projectId;
      const generation = activityHydrationGeneration;
      activityStarted = true;
      activityController = new AbortController();
      void streamActivity(activityController.signal, projectId, generation);
    };
    const restartActivity = () => {
      activityController?.abort();
      activityStarted = false;
      activityController = undefined;
      activity = [];
      state.pendingDecisions = [];
      const generation = ++activityHydrationGeneration;
      const projectId = project.kind === "attached" ? project.projectId : undefined;
      if (projectId !== undefined) void hydrateActivity(projectId, generation).then(() => {
        if (generation === activityHydrationGeneration) startActivity();
      });
    };
    const retryConnection = async () => {
      appendWarning("Retrying Maestro startup checks…");
      if (startupError !== undefined) {
        try {
          workspace = await resolveWorkspace(options.cwd);
          state.workspace = workspace;
          startupError = undefined;
        } catch (error) {
          startupError = error instanceof Error ? error.message : "Workspace could not be resolved";
          state.connection = { kind: "error", message: `Workspace unavailable: ${startupError}` };
          appendError(`Startup retry failed: ${startupError}`);
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
            appendWarning(`Startup retry blocked: ${connection.reason}`);
            return;
          }
        } else {
          state.connection = { kind: "setup-required", message: connection.reason };
          appendWarning(`Startup retry blocked: ${connection.reason}`);
          return;
        }
      }
      const health = await ensureLocalControlPlane({
        apiUrl: connection.apiUrl,
        ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
      });
      if (health.kind !== "ready") {
        state.connection = { kind: "error", message: health.reason };
        appendError(`Startup retry failed: ${health.reason}`);
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
        appendSuccess("Control Plane connected.");
        if (projectDiscoveryNotice !== undefined) appendWarning(projectDiscoveryNotice);
        void refreshDashboard();
        restartActivity();
      } catch {
        client = undefined;
        state.connection = { kind: "error", message: "Control Plane client could not be created" };
        appendError("Startup retry failed: Control Plane client could not be created");
      }
    };
    const cancelAccountLogin = (): void => {
      const controller = accountLoginController;
      accountLoginController = undefined;
      const loginId = accountLoginId;
      accountLoginId = undefined;
      accountLoginUrl = undefined;
      accountLoginSelection = undefined;
      accountLoginState = undefined;
      editor.hidden = false;
      editor.setText("");
      controller?.abort();
      if (loginId !== undefined && client !== undefined) void client.cancelAccountLogin(loginId).catch(() => undefined);
      render();
    };
    const startAccountLogin = async (): Promise<void> => {
      if (client === undefined) { appendWarning("Account login is unavailable until the Control Plane is connected."); cancelAccountLogin(); return; }
      if (accountLoginSelection === 1) { appendWarning("Claude Pro / Max account login is unavailable until Anthropic approves a public OAuth integration."); cancelAccountLogin(); return; }
      accountLoginState = "opening";
      render();
      const controller = new AbortController();
      accountLoginController = controller;
      try {
        const login = await client.startAccountLogin();
        accountLoginId = login.loginId;
        accountLoginUrl = login.authUrl;
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
        if (status.state === "succeeded") { appendSuccess("Account login complete: openai-codex"); void refreshDashboard(); }
        else if (status.state === "failed") appendError(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
        else appendWarning(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
      } catch (error) { if (!controller.signal.aborted) appendError(`Account login failed: ${error instanceof Error ? error.message : "request failed"}`); }
      finally { if (accountLoginController === controller) { accountLoginController = undefined; accountLoginId = undefined; accountLoginUrl = undefined; accountLoginSelection = undefined; accountLoginState = undefined; editor.hidden = false; render(); } }
    };

    const submit = async (text: string) => {
      if (text.trim() !== "") splash.dismiss();
      if (pendingProviderLogin !== undefined) {
        const providerId = pendingProviderLogin;
        pendingProviderLogin = undefined;
        editor.hidden = false;
        editor.setText("");
        if (client === undefined) {
          appendWarning("Provider login is unavailable until the Control Plane is connected.");
          return;
        }
        try {
          await client.loginProvider({ providerId, authMode: "api-key", secret: text });
          appendSuccess(`Provider login complete: ${providerId} API key stored by the model gateway.`);
        } catch (error) {
          appendError(`Provider login failed: ${error instanceof Error ? error.message : "request failed"}`);
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
            appendWarning("Provider login is unavailable until the Control Plane is connected.");
          } else {
            pendingProviderLogin = parsed.action;
            editor.hidden = true;
            editor.setText("");
            append(`Enter the ${parsed.action} API key and press Enter. Input is hidden and never saved to session history.`);
            render();
          }
        } else if (parsed.kind === "command" && parsed.name === "logout" && parsed.action === "openai-codex") {
          if (client === undefined) appendWarning("Account logout is unavailable until the Control Plane is connected.");
          else {
            await client.logoutAccount();
            appendSuccess("ChatGPT account signed out; its model bindings were revoked.");
            void refreshDashboard();
          }
        } else if (parsed.kind === "command" && parsed.name === "logout" && (parsed.action === "openai" || parsed.action === "anthropic")) {
          if (client === undefined) appendWarning("Provider logout is unavailable until the Control Plane is connected.");
          else {
            await client.logoutProvider(parsed.action);
            appendSuccess(`Provider credential revoked: ${parsed.action}.`);
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
            conversationStreamController?.abort();
            conversationStreamController = undefined;
            conversationHydrationGeneration += 1;
            conversationHydration = Promise.resolve();
            conversation = createConversationTranscript();
            session = startNewConversationSession(workspace.cwd, session);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(workspace.cwd, session);
            appendSuccess("New Concertmaster conversation started. Durable Goal state was preserved.");
          } else if (parsed.action === "attach") {
            conversationStreamController?.abort();
            conversationStreamController = undefined;
            conversationHydrationGeneration += 1;
            conversationHydration = Promise.resolve();
            conversation = createConversationTranscript();
            const requestedProjectId = parsed.options["project-id"];
            const requestedProjectIndex = parsed.options["project-index"];
            const current = await loadWorkspaceSession(workspace.cwd);
            if (typeof requestedProjectId === "string" && requestedProjectId.trim() !== "") {
              session = attachWorkspaceSession(workspace.cwd, current, requestedProjectId);
              syncModelState();
              await saveWorkspaceSession(session);
            } else if (typeof requestedProjectIndex === "string" && requestedProjectIndex.trim() !== "") {
              if (client === undefined) {
                appendWarning("Project discovery is unavailable until the Control Plane is connected.");
                return;
              }
              const index = Number(requestedProjectIndex);
              const projects = (await client.listProjects()).projects;
              if (!Number.isSafeInteger(index) || index < 1 || index > projects.length) {
                appendWarning(`Project index must be a number from 1 to ${projects.length}.`);
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
                appendWarning(discovered.reason);
                return;
              }
              session = attachWorkspaceSession(workspace.cwd, current, discovered.projectId);
              syncModelState();
              await saveWorkspaceSession(session);
            } else {
              appendWarning("Session attach requires a connected Control Plane or --project-id.");
              return;
            }
            project = discoverWorkspaceProject(workspace.cwd, session);
            projectDiscoveryNotice = undefined;
            recovery = reconcileTuiSession(workspace.cwd, session);
            append(renderRecoveryBanner(recovery, terminal.columns).join(" · "));
            void refreshDashboard();
            restartActivity();
            if (project.kind === "attached") {
              const generation = ++conversationHydrationGeneration;
              conversationHydration = hydrateConversation(session?.conversationId, project.projectId, generation);
            }
          } else if (parsed.action === "list") {
            const current = await loadWorkspaceSession(workspace.cwd);
            append(
              current === undefined
                ? "Session: no saved workspace session"
                : renderRecoveryBanner(reconcileTuiSession(workspace.cwd, current), terminal.columns).join(" · "),
            );
          } else {
            appendWarning(`Command: /session ${parsed.action ?? ""} (unknown session action)`.trim());
          }
        } else if (parsed.kind === "command" && parsed.name === "goal" && parsed.action === "select") {
          const requestedGoalId = parsed.options["goal-id"];
          if (client === undefined || project.kind !== "attached") {
            appendWarning("Goal selection is unavailable until a workspace project is attached.");
          } else if (typeof requestedGoalId !== "string" || requestedGoalId.trim() === "") {
            appendWarning("Goal selection requires --goal-id.");
          } else {
            const selected = await client.getGoal(requestedGoalId, { projectId: project.projectId });
            if (selected.projectId !== project.projectId) throw new Error("Selected Goal is bound to another project");
            const current = await loadWorkspaceSession(workspace.cwd);
            session = selectWorkspaceGoal(workspace.cwd, current ?? session, selected.goalId);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(workspace.cwd, session, { goalState: selected.state });
            appendSuccess(`Selected Goal: ${selected.goalId} · ${selected.state} · v${selected.version}`);
            void refreshDashboard();
          }
        } else if (parsed.kind === "command" && parsed.name === "projects" && parsed.action === "list") {
          if (client === undefined) {
            appendWarning("Projects unavailable until the Control Plane is connected.");
          } else {
            const readResult = await executeReadCommand(
              { client, projectId: project.kind === "attached" ? project.projectId : "" },
              parsed,
            );
            append(`${readResult.title}: ${readResult.lines.join(" · ")}`);
          }
        } else if (parsed.kind === "command" && (parsed.name === "models" || parsed.name === "model") && (parsed.action === undefined || parsed.action === "list")) {
          if (client === undefined) appendWarning("Model catalog unavailable until the Control Plane is connected.");
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
            appendWarning("Model selection is unavailable until the Control Plane is connected.");
          } else if (typeof requestedModel !== "string" || requestedModel.trim() === "") {
            appendWarning("Model selection requires --model provider/model (use /model list first).");
          } else {
            const models = await client.listModels();
            const selected = models.find((model) => `${model.identity.provider}/${model.identity.id}` === requestedModel);
            if (selected === undefined) {
              appendWarning(`Model is not available: ${requestedModel}`);
            } else if (session?.conversationId !== undefined) {
              appendWarning("The active conversation is bound to its model. Use /session new before selecting another model.");
            } else {
              session = selectWorkspaceModel(workspace.cwd, session, requestedModel);
              await saveWorkspaceSession(session);
              state.model = requestedModel;
              appendSuccess(`Selected model: ${requestedModel}`);
            }
          }
        } else if (parsed.kind === "command" && parsed.name === "conversation" && parsed.action === "cancel") {
          if (client === undefined || project.kind !== "attached" || session?.conversationId === undefined)
            appendWarning("No active conversation is available to cancel.");
          else {
            conversationTurnController?.abort();
            const cancelled = await client.cancelConversation(session.conversationId, { projectId: project.projectId });
            appendWarning(`Conversation ${cancelled.conversationId}: ${cancelled.status}`);
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
            syncPendingDecisionState();
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
            appendWarning("Concertmaster requires an attached workspace project.");
          } else if (flashmobMode) {
            append(
              "Flashmob is a planned bounded fast path, but its Vanguard runtime is not wired yet. Switch to /mode maestro for governed conversation.",
            );
          } else if (session?.goalId === undefined) {
            appendWarning("Select a Goal before sending a Concertmaster message (use /goal select --goal-id <id>).");
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
                }, { idempotencyKey: randomUUID() });
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
                appendSuccess(`Concertmaster conversation ${created.conversationId} · ${created.model}`);
              }
              const activeConversationId = session.conversationId;
              if (activeConversationId === undefined) throw new Error("Conversation was not created");
              await conversationHydration;
              conversation = addConversationMessage(conversation, "user", text);
              render();
              const streamController = new AbortController();
              conversationStreamController?.abort();
              conversationStreamController = streamController;
              void streamConversation(activeConversationId, project.projectId, streamController);
              const turnController = new AbortController();
              conversationTurnController = turnController;
              state.working = true;
              render();
              try {
                const result = await client.sendConversationTurn(
                  activeConversationId,
                  { projectId: project.projectId, text },
                  { signal: turnController.signal, idempotencyKey: randomUUID() },
                );
                const terminalType = result.turn.status === "completed" ? "turn_completed" : result.turn.status === "cancelled" ? "turn_cancelled" : result.turn.status === "failed" ? "turn_failed" : "turn_unknown";
                const terminalEvent: ConversationEvent = {
                  cursor: result.turn.cursor,
                  eventId: result.turn.turnId,
                  conversationId: result.turn.conversationId,
                  projectId: project.projectId,
                  eventType: terminalType,
                  payload: { turnId: result.turn.turnId, status: result.conversation.status, ...(result.turn.status === "completed" ? { content: result.turn.content } : { message: result.turn.content }) },
                  occurredAt: result.turn.createdAt,
                };
                conversation = applyConversationEvent(conversation, terminalEvent);
                render();
              } finally {
                if (conversationTurnController === turnController) conversationTurnController = undefined;
                state.working = false;
                render();
              }
            }
          }
        }
      } catch (error) {
        appendError(`Input error: ${error instanceof Error ? error.message : "invalid input"}`);
      }
      editor.addToHistory(text);
    };
    editor.onSubmit = (text) => {
      void submit(text);
    };
    // Keep status and decisions outside the scroll view; only the chronological
    // conversation/activity stream may scroll or follow new output.
    const transcriptView = new ScrollView(header, { follow: "end", primary: true, overscroll: "chain", scrollbar: "auto" });
    const dock = new VStack([composer, footer]);
    tui.setLayoutRoot(new VStack([
      { component: statusRegion, basis: "auto", shrink: 0, minSize: 1 },
      { component: transcriptView, basis: 0, grow: 1, minSize: 0, visible: () => terminal.rows >= 16 },
      { component: decisionRegion, basis: "auto", shrink: 0, minSize: 0, visible: () => (state.pendingDecisions?.length ?? 0) > 0 },
      { component: noticeRegion, basis: "auto", shrink: 0, minSize: 0, visible: () => terminal.rows >= 16 },
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
      syncPendingDecisionState();
      activityController?.abort();
      conversationTurnController?.abort();
      conversationStreamController?.abort();
      accountLoginController?.abort();
      if (accountLoginId !== undefined && client !== undefined) void client.cancelAccountLogin(accountLoginId).catch(() => undefined);
      flashmobAnimationId += 1;
      tui.stop();
      resolve(0);
    };
    const cancelActiveConversation = (): boolean => {
      if (conversationTurnController === undefined) return false;
      conversationTurnController.abort();
      appendWarning("Cancelling the active conversation turn…");
      if (client !== undefined && project.kind === "attached" && session?.conversationId !== undefined) {
        void client
          .cancelConversation(session.conversationId, { projectId: project.projectId })
          .then((cancelled) => appendWarning(`Conversation ${cancelled.conversationId}: ${cancelled.status}`))
          .catch((error) => appendError(`Conversation cancellation unavailable: ${error instanceof Error ? error.message : "unknown error"}`));
      }
      return true;
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
      if (matchesKey(data, "escape") && cancelActiveConversation()) return { consume: true };
      if (matchesKey(data, "ctrl+c")) {
        if (cancelActiveConversation()) return { consume: true };
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
      if (accountLoginSelection !== undefined && accountLoginState === "waiting" && matchesKey(data, "alt+c")) {
        const url = accountLoginUrl;
        if (url === undefined) appendWarning("The provider login link is not ready yet.");
        else {
          void (options.io.copyToClipboard ?? copyToClipboard)(url)
            .then(() => appendSuccess("Provider login link copied to the clipboard."))
            .catch(() => appendWarning(`Clipboard unavailable. Copy this provider login link: ${url}`));
        }
        return { consume: true };
      }
      if (accountLoginSelection !== undefined && accountLoginState === "waiting" && matchesKey(data, "escape")) {
        cancelAccountLogin();
        appendWarning("Account login cancelled.");
        return { consume: true };
      }
      if (pendingConfirmation !== undefined && (matchesKey(data, "up") || matchesKey(data, "down")) && pendingConfirmation.summary.repetitionScope !== undefined) {
        pendingConfirmation = {
          ...pendingConfirmation,
          summary: {
            ...pendingConfirmation.summary,
            repetitionScope: nextApprovalDialogScope(pendingConfirmation.summary.repetitionScope, matchesKey(data, "up") ? -1 : 1),
          },
        };
        render();
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+a") && pendingConfirmation !== undefined) {
        append(renderApprovalDialog(pendingConfirmation.summary, terminal.columns).join("\n"));
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+a") && pendingConfirmation === undefined && (state.pendingDecisions?.length ?? 0) > 0) {
        append(renderPendingDecisionDetails(state, terminal.columns).join("\n"));
        return { consume: true };
      }
      if (pendingConfirmation !== undefined && data === "?") {
        const { summary } = pendingConfirmation;
        appendWarning(`Approval tier: ${summary.tier === "user" ? "You" : summary.tier ?? "You"}; scope: ${summary.repetitionScope ?? "once"}. Reject proposes: ${summary.saferAlternative ?? "a safer alternative"}`);
        return { consume: true };
      }
      if (
        pendingConfirmation !== undefined &&
        (data === "y" || data === "Y" || data === "n" || data === "N" || data === "\r" || data === "\u001b")
      ) {
        const decision: ConfirmationResult = data === "y" || data === "Y"
          ? (pendingConfirmation.summary.repetitionScope === undefined
            ? "approved"
            : { decision: "approved", repetitionScope: pendingConfirmation.summary.repetitionScope })
          : "cancelled";
        const resolveConfirmation = pendingConfirmation.resolve;
        pendingConfirmation = undefined;
        syncPendingDecisionState();
        resolveConfirmation(decision);
        render();
        return { consume: true };
      }
      return undefined;
    });
    const runtime = createTuiRuntime({ start: () => tui.start(), stop });
    runtime.start();
    if (projectDiscoveryNotice !== undefined) appendWarning(projectDiscoveryNotice);
    void refreshDashboard();
    if (project.kind === "attached") {
      const activityGeneration = ++activityHydrationGeneration;
      void hydrateActivity(project.projectId, activityGeneration).then(() => {
        if (activityGeneration === activityHydrationGeneration) startActivity();
      });
    }
    if (project.kind === "attached") {
      const generation = ++conversationHydrationGeneration;
      conversationHydration = hydrateConversation(session?.conversationId, project.projectId, generation);
    }
  });
}
