import { Box, CombinedAutocompleteProvider, HStack, ProcessTerminal, ScrollView, Text, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import type { GoalEvent } from "@maestro/api-client";
import type { TaskContract } from "@maestro/contracts";
import { createCommandRegistry } from "../commands/registry.js";
import { createCommandAutocompleteItems, createSlashCommandAutocompleteProvider } from "../commands/autocomplete.js";
import { reconcileTuiSession, type RecoverySummary } from "../recovery.js";
import { createDecisionRegion, createDynamicRegion } from "../components/regions.js";
import { renderStatusSection, toSidebarStatus } from "../components/shell.js";
import { contentWidth, isSidebarVisible, renderSidebar, SIDEBAR_WIDTH } from "../components/sidebar.js";
import { approvalDialogClickLines, applyApprovalAction, createApprovalClickRegion } from "../components/approval-dialog-click.js";
import { applyProviderLoginAction, createProviderLoginClickRegion } from "../components/provider-login-click.js";
import { type TuiShellState } from "../components/shell.js";
import type { ApprovalDialogSummary, ConfirmationResult, CriticalActionSummary } from "../confirmation.js";
import type { createStatusRegion } from "../components/regions.js";
import { tuiTheme } from "../theme.js";
import { editorTheme, SecretEditor } from "../components/editors.js";
import { ConversationViewport, FramedComposer } from "../components/conversation-viewport.js";
import { createTranscriptClearBoundary } from "../basic-shell.js";
import { createConversationTurnBoundary } from "../conversation-turn-boundary.js";
import { createAutomaticProviderSignInGate } from "../entry-helpers.js";
import { createTuiRuntime } from "../runtime.js";
import { renderProviderLoginDialog, type AccountLoginProviderSelection } from "../components/provider-login-dialog.js";
import { renderRecoveryBanner } from "../components/recovery-banner.js";
import { renderUnifiedStreamEntries } from "../conversation-transcript.js";
import type { ConversationTranscriptState } from "../conversation-transcript.js";
import { createConversationTranscript } from "../conversation-transcript.js";
import { workspaceIdentity } from "../workspace.js";
import { refreshDashboardState } from "../dashboard-refresh.js";
import { readDashboard } from "../commands/read-commands.js";
import type { InteractiveTuiOptions } from "../startup.js";
import type { initializeTui } from "../startup.js";
import type { LocalBootstrapStepEvent } from "@maestro/local-backend";
import { TuiView } from "./view.js";
import { ActivitySync } from "./activity.js";
import { AuthFlows } from "./auth.js";
import { ConnectionFlow } from "./connection.js";
import { LifecycleHandler } from "./lifecycle.js";
import { SubmitDispatcher } from "./submit/dispatcher.js";

export type InitializedTui = Awaited<ReturnType<typeof initializeTui>>;

export interface TuiControllerOptions {
  terminal: ProcessTerminal;
  tui: TuiAltScreen;
  state: TuiShellState;
  splash: { dismiss(): void; restore(): void };
  options: InteractiveTuiOptions;
  updateSetupStep: (event: LocalBootstrapStepEvent) => void;
  startTui: () => void;
  workspace: InitializedTui["workspace"];
  startupError: InitializedTui["startupError"];
  connection: InitializedTui["connection"];
  session: InitializedTui["session"];
  project: InitializedTui["project"];
  projectDiscoveryNotice: InitializedTui["projectDiscoveryNotice"];
  client: InitializedTui["client"];
  statusRegion: ReturnType<typeof createStatusRegion>;
}

export class TuiController {
  terminal: ProcessTerminal;
  tui: TuiAltScreen;
  state: TuiShellState;
  splash: { dismiss(): void; restore(): void };
  options: InteractiveTuiOptions;
  updateSetupStep: (event: LocalBootstrapStepEvent) => void;
  startTui: () => void;
  workspace: InitializedTui["workspace"];
  startupError: InitializedTui["startupError"];
  connection: InitializedTui["connection"];
  session: InitializedTui["session"];
  project: InitializedTui["project"];
  projectDiscoveryNotice: InitializedTui["projectDiscoveryNotice"];
  client: InitializedTui["client"];
  statusRegion: ReturnType<typeof createStatusRegion>;
  sessionWorkspacePath: string;

  compactReview: string | undefined = undefined;
  compactHelp: string | undefined = undefined;
  compactModelList: { identities: string[]; unavailableLabel?: string } | undefined = undefined;
  compactCommandResult: string | undefined = undefined;
  compactConversationResult: string | undefined = undefined;
  compactTaskContractReview = false;
  compactProjectNotice: string | undefined;
  lastRenderedTerminalRows: number;
  sidebarVisible = true;

  /** Main-pane width: full terminal minus the visible sidebar. */
  contentWidth(): number {
    return contentWidth(this.terminal.columns, this.sidebarVisible);
  }

  conversation: ConversationTranscriptState = createConversationTranscript();
  draftedTaskContract: TaskContract | undefined = undefined;
  renderedDraftIdentity: string | undefined = undefined;
  activity: GoalEvent[] = [];
  visibleActivityStart = 0;
  recovery: RecoverySummary;
  pendingConfirmation: { summary: ApprovalDialogSummary; resolve: (decision: ConfirmationResult) => void } | undefined = undefined;

  activityStarted = false;
  activityHydrationGeneration = 0;
  readonly activityHistoryBoundary = createTranscriptClearBoundary();
  readonly conversationDisplayBoundary = createTranscriptClearBoundary();
  activityController: AbortController | undefined = undefined;
  conversationTurnController: AbortController | undefined = undefined;
  naturalSubmitInFlight = false;
  readonly conversationTurnBoundary = createConversationTurnBoundary();

  pendingProviderLogin: "openai" | "anthropic" | undefined = undefined;
  providerLoginInFlight = false;
  providerLoginInFlightProvider: "openai" | "anthropic" | undefined = undefined;
  providerLoginGeneration = 0;
  accountLoginSelection: AccountLoginProviderSelection | undefined = undefined;
  accountLoginState: "selecting" | "opening" | "waiting" | undefined = undefined;
  accountLoginController: AbortController | undefined = undefined;
  accountLoginId: string | undefined = undefined;
  accountLoginUrl: string | undefined = undefined;
  connectionGeneration: number;
  loginInteractionGeneration = 0;
  readonly automaticProviderSignInGate = createAutomaticProviderSignInGate();

  conversationStreamController: AbortController | undefined = undefined;
  conversationActivityController: AbortController | undefined = undefined;
  workingLoaderTimer: ReturnType<typeof setInterval> | undefined = undefined;
  conversationHydration: Promise<void> = Promise.resolve();
  conversationHydrationGeneration = 0;

  flashmobMode = false;
  flashmobAnimationId = 0;
  dashboardRefreshGeneration = 0;
  stopped = false;
  finish: (code: number) => void = () => undefined;

  editor!: SecretEditor;
  footer!: Text;
  header!: ConversationViewport;
  registry!: ReturnType<typeof createCommandRegistry>;

  readonly view = new TuiView(this);
  readonly activitySync = new ActivitySync(this);
  readonly auth = new AuthFlows(this);
  readonly connectionFlow = new ConnectionFlow(this);
  readonly lifecycle = new LifecycleHandler(this);
  readonly submitter = new SubmitDispatcher(this);

  constructor(opts: TuiControllerOptions) {
    this.terminal = opts.terminal;
    this.tui = opts.tui;
    this.state = opts.state;
    this.splash = opts.splash;
    this.options = opts.options;
    this.updateSetupStep = opts.updateSetupStep;
    this.startTui = opts.startTui;
    this.workspace = opts.workspace;
    this.startupError = opts.startupError;
    this.connection = opts.connection;
    this.session = opts.session;
    this.project = opts.project;
    this.projectDiscoveryNotice = opts.projectDiscoveryNotice;
    this.client = opts.client;
    this.statusRegion = opts.statusRegion;
    this.sessionWorkspacePath = workspaceIdentity(opts.workspace);
    this.compactProjectNotice = opts.projectDiscoveryNotice;
    this.lastRenderedTerminalRows = opts.terminal.rows;
    this.connectionGeneration = opts.client === undefined ? 0 : 1;
    this.recovery = reconcileTuiSession(this.sessionWorkspacePath, opts.session);
  }

  invalidateDashboardRefreshes = (): void => {
    this.dashboardRefreshGeneration += 1;
  };

  resetConversationStream = (scope: "transcript" | "session"): void => {
    if (scope === "session") this.invalidateDashboardRefreshes();
    else this.activityHistoryBoundary.clear();
    this.conversationTurnBoundary.invalidate();
    if (scope === "transcript") this.conversationDisplayBoundary.clear();
    this.conversationStreamController?.abort();
    this.conversationActivityController?.abort();
    this.conversationActivityController = undefined;
    this.conversationStreamController = undefined;
    this.conversationHydrationGeneration += 1;
    this.conversationHydration = Promise.resolve();
    this.conversation = createConversationTranscript();
    if (scope === "transcript") this.visibleActivityStart = this.activity.length;
  };

  refreshDashboard = async (): Promise<void> => {
    const generation = ++this.dashboardRefreshGeneration;
    const project = this.project;
    if (this.client === undefined || project.kind !== "attached") return;
    const requestClient = this.client;
    const requestProjectId = project.projectId;
    const requestGoalId = this.session?.goalId;
    await refreshDashboardState({
      client: requestClient,
      projectId: requestProjectId,
      ...(requestGoalId === undefined ? {} : { goalId: requestGoalId }),
      readDashboard,
      isCurrent: () =>
        !this.stopped &&
        generation === this.dashboardRefreshGeneration &&
        this.client === requestClient &&
        this.project.kind === "attached" &&
        this.project.projectId === requestProjectId &&
        this.session?.goalId === requestGoalId,
      setDashboardState: (dashboardState) => {
        this.state.goal = dashboardState.goal;
        this.state.workers = dashboardState.workers;
        this.state.budget = dashboardState.budget;
      },
      setRecovery: (dashboard) => {
        this.recovery = reconcileTuiSession(this.sessionWorkspacePath, this.session, {
          ...(dashboard.selectedGoal === undefined ? {} : { goalState: dashboard.selectedGoal.state }),
          ...(dashboard.workerCount === undefined ? {} : { activeWorkers: dashboard.workerCount }),
        });
      },
      render: this.view.render,
    });
  };

  confirm = (summary: CriticalActionSummary): Promise<ConfirmationResult> =>
    new Promise((resolveConfirmation) => {
      this.pendingConfirmation = { summary, resolve: resolveConfirmation };
      this.view.syncPendingDecisionState();
      this.view.render();
    });

  async run(): Promise<number> {
    const { terminal, tui, state } = this;
    this.editor = new SecretEditor(tui, editorTheme, { paddingX: 2, autocompleteMaxVisible: 6 });
    const inputPanel = new Box(1, 0, tuiTheme.inputSurface);
    const inputLabel = this.view.buildInputLabel();
    inputPanel.addChild(inputLabel);
    inputPanel.addChild(this.editor);
    const composer = new FramedComposer(inputPanel);
    this.footer = new Text("", 0, 0);
    this.header = new ConversationViewport();
    this.registry = createCommandRegistry();
    const autocompleteProvider = new CombinedAutocompleteProvider(createCommandAutocompleteItems(this.registry), this.workspace.cwd);
    this.editor.setAutocompleteProvider(createSlashCommandAutocompleteProvider(autocompleteProvider));
    this.editor.onSubmit = (text) => {
      void this.submitter.submit(text);
    };
    // Keep status and decisions outside the scroll view; only the chronological
    // conversation/activity stream may scroll or follow new output.
    const decisionRegion = createDecisionRegion({ state, height: () => terminal.rows });
    // Clickable approval dialog: same actions as the y/n/scope keyboard path,
    // mounted only while a confirmation is pending.
    const approvalClickRegion = createApprovalClickRegion({
      lines: (width) => approvalDialogClickLines(this, width),
      onAction: (action) => {
        applyApprovalAction(this, action);
      },
    });
    const noticeRegion = createDynamicRegion(() => {
      if (terminal.rows < 16 && this.accountLoginSelection === undefined) return [];
      return terminal.rows < 16 ? [] : [...renderRecoveryBanner(this.recovery, this.contentWidth())];
    });
    // Clickable provider-login options: selecting a row is the same action as
    // the up/down keys; Enter still confirms and starts the flow.
    const providerLoginClickRegion = createProviderLoginClickRegion({
      lines: (width) => {
        const selection = this.accountLoginSelection;
        const loginState = this.accountLoginState;
        if (selection === undefined || loginState === undefined) return [];
        return renderProviderLoginDialog(width, selection, loginState, this.accountLoginUrl, terminal.rows < 16);
      },
      isCompact: () => terminal.rows < 16,
      onSelect: (selection) => {
        applyProviderLoginAction(this, { kind: "select", selection });
      },
    });
    this.header.setOrderedStreamRenderer(() =>
      renderUnifiedStreamEntries(this.conversation, this.activity.slice(this.visibleActivityStart), this.contentWidth()),
    );
    this.view.render();
    const transcriptView = new ScrollView(this.header, { follow: "end", primary: true, overscroll: "chain", scrollbar: "auto" });
    const dock = new VStack([composer, this.footer]);
    const sidebarRegion = createDynamicRegion((width) => renderSidebar(width, renderStatusSection(toSidebarStatus(state), width)));
    const mainColumn = new VStack([
      { component: this.statusRegion, basis: "auto", shrink: 0, minSize: 1 },
      { component: transcriptView, basis: 0, grow: 1, minSize: 0, visible: () => terminal.rows >= 16 },
      { component: decisionRegion, basis: "auto", shrink: 0, minSize: 0, visible: () => (state.pendingDecisions?.length ?? 0) > 0 },
      {
        component: approvalClickRegion,
        basis: "auto",
        shrink: 0,
        minSize: 0,
        visible: () => this.pendingConfirmation !== undefined && terminal.rows >= 16,
      },
      {
        component: noticeRegion,
        basis: "auto",
        shrink: 0,
        minSize: 0,
        visible: () => terminal.rows >= 16 || this.accountLoginSelection !== undefined,
      },
      {
        component: providerLoginClickRegion,
        basis: "auto",
        shrink: 0,
        minSize: 0,
        visible: () => this.accountLoginSelection !== undefined && this.accountLoginState !== undefined,
      },
      { component: dock, basis: "auto", shrink: 1, minSize: 1 },
    ]);
    tui.setLayoutRoot(
      new HStack([
        {
          component: sidebarRegion,
          basis: SIDEBAR_WIDTH,
          shrink: 0,
          minSize: 0,
          visible: () => isSidebarVisible(this.sidebarVisible, terminal.columns),
        },
        { component: mainColumn, basis: 0, grow: 1, minSize: 0 },
      ]),
    );
    tui.setFocus(this.editor);
    this.view.render();
    tui.addInputListener((data) => this.lifecycle.handleInput(data));
    const runtime = createTuiRuntime({ start: this.startTui, stop: this.lifecycle.stop });
    runtime.start();
    if (this.projectDiscoveryNotice !== undefined) this.view.appendWarning(this.projectDiscoveryNotice);
    void this.refreshDashboard();
    void this.auth.offerAutomaticProviderSignIn();
    if (this.project.kind === "attached") {
      const activityGeneration = ++this.activityHydrationGeneration;
      void this.activitySync.hydrateActivity(this.project.projectId, activityGeneration).then(() => {
        if (activityGeneration === this.activityHydrationGeneration) this.activitySync.startActivity();
      });
    }
    if (this.project.kind === "attached") {
      const generation = ++this.conversationHydrationGeneration;
      this.conversationHydration = this.activitySync.hydrateConversation(this.session?.conversationId, this.project.projectId, generation);
    }
    return await new Promise<number>((resolve) => {
      this.finish = resolve;
    });
  }
}
