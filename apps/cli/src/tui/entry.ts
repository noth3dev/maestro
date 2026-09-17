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
import { ApiError, createApiClient, type ApiClient, type GoalEvent } from "@maestro/api-client";
import type { ConversationEvent, ModelCatalogEntry, TaskContract } from "@maestro/contracts";

import { resolveRetryWorkspace } from "./retry-workspace.js";
import { workspaceIdentity } from "./workspace.js";
import { createTranscriptClearBoundary, executeBasicShellCommand, latestCopyableTranscriptText } from "./basic-shell.js";
import { waitForAccountLogin } from "./account-login.js";
import { hydrateActivityHistory } from "./activity-history-hydration.js";
import { runLiveActivityStream } from "./activity-live-stream.js";
import { refreshDashboardState } from "./dashboard-refresh.js";
import { selectedConversationGoalId } from "./dashboard-state.js";
import { loadConversationHistory } from "./conversation-history.js";
import { createConversationTurnBoundary } from "./conversation-turn-boundary.js";
import { pendingDecisionsForView } from "./pending-decisions.js";
import { draftForPresentation } from "./draft-presentation.js";
import { priorTaskContractDraft, taskContractDraftForConversation } from "./conversation-draft.js";
import { animateAccentProgress } from "./flashmob-animation.js";
import { reconnectWorkspaceProject } from "./project-reconnect.js";
import { cancelConversationTurn } from "./conversation-cancellation.js";

import { ensureLocalControlPlane } from "./local-control-plane.js";
import { resolveLocalConnection } from "./local-bootstrap.js";
import { createCommandRegistry } from "./commands/registry.js";
import { createCommandAutocompleteItems } from "./commands/autocomplete.js";
import { dispatchCommandPaletteInput } from "./commands/palette.js";
import { parseInput } from "./commands/parser.js";
import {
  executeReadCommand,
  discoverWorkspaceProject,
  discoverWorkspaceProjectFromControlPlane,
  readDashboard,
} from "./commands/read-commands.js";
import { executeWriteCommand } from "./commands/write-commands.js";
import { dispatchInteractiveWriteCommand } from "./commands/interactive-dispatch.js";
import { renderApprovalDialog } from "./components/approval-dialog.js";
import {
  COMPACT_PROVIDER_LOGIN_MIN_HEIGHT,
  renderProviderLoginDialog,
  type AccountLoginProviderSelection,
} from "./components/provider-login-dialog.js";
import { reconcileTuiSession, type RecoverySummary } from "./recovery.js";
import { renderRecoveryBanner } from "./components/recovery-banner.js";
import {
  nextApprovalDialogScope,
  type ApprovalDialogSummary,
  type CriticalActionSummary,
  type ConfirmationResult,
} from "./confirmation.js";
import {
  attachWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
  selectWorkspaceGoal,
  selectWorkspaceModel,
  startNewConversationSession,
  type WorkspaceSession,
} from "./session.js";
import { subscribeToEvents } from "./activity-stream.js";
import {
  addConversationMessage,
  applyConversationEvent,
  createConversationTranscript,
  isTerminalConversationEvent,
  renderUnifiedStreamEntries,
  type ConversationTranscriptState,
} from "./conversation-transcript.js";
import { createDecisionRegion, createDynamicRegion, createStatusRegion } from "./components/regions.js";
import {
  createSplashController,
  renderInputPlaceholder,
  renderPendingDecisionDetails,
  renderTuiFooter,
  setupRequiredGuidance,
  type PendingDecision,
  type TuiShellState,
} from "./components/shell.js";
import { fitPlain, getModeAccentProgress, setModeAccentProgress, tuiTheme, type TranscriptLine } from "./theme.js";

import { copyToClipboard, openExternalUrl } from "../external-url.js";
import { MAESTRO_VERSION } from "../version.js";
import { editorTheme, SecretEditor } from "./components/editors.js";
import { ConversationViewport, FramedComposer } from "./components/conversation-viewport.js";
import { buildConversationInput, renderTaskContractDraft } from "./goal-less-intake.js";

export { type InteractiveTuiOptions } from "./startup.js";
import { hydrateOrganizationState, initializeTui, shouldAutoBootstrapLocal, type InteractiveTuiOptions } from "./startup.js";

/** A selected model is only resolvable when the gateway exposes that exact model. */
/** Ctrl+/ is sent as US (0x1f) by common terminals; Kitty/modifyOtherKeys uses matchesKey. */
export function isSplashRestoreShortcut(data: string): boolean {
  return data === "\x1f" || matchesKey(data, "ctrl+/");
}

export function isStartupCancellationInput(data: string): boolean {
  return matchesKey(data, "ctrl+c") || matchesKey(data, "escape");
}

export function compactReviewAcknowledgement(
  summary: Pick<ApprovalDialogSummary, "action" | "tier"> | undefined,
  pendingDecisions: readonly PendingDecision[],
  width: number,
): string | undefined {
  if (summary !== undefined) {
    const tier = summary.tier === "user" ? "You" : (summary.tier ?? "You");
    return fitPlain(`Review: ${summary.action} · approval · ${tier}`, width);
  }
  const decisions = pendingDecisions.filter((decision) => decision.identity.trim() !== "");
  const first = decisions[0];
  if (first === undefined) return undefined;
  return fitPlain(`Review: ${first.action} · ${decisions.length} pending · ⏸ ${first.tier}`, width);
}

export function compactHelpAcknowledgement(width: number): string {
  return fitPlain("Help available; resize to view commands", width);
}

export function noModelSelectionMessage(): string {
  return [
    "No model selected.",
    "Run /models list.",
    "If a model is available, run:",
    "/model use --model provider/model",
    "Set MAESTRO_MODEL before a new session.",
  ].join("\n");
}

export function compactProjectAttachmentNotice(projectDiscoveryNotice: string | undefined, width: number): string {
  if (projectDiscoveryNotice === "No projects are available for this operator") return fitPlain("No project · admin provision · ctrl+r", width);
  if (projectDiscoveryNotice?.startsWith("Project discovery unavailable:")) return fitPlain("Discovery failed · ctrl+r retry", width);
  const match = projectDiscoveryNotice?.match(/\/session attach(?:\s+--project-index=\d+)?/);
  const command = match?.[0] ?? "/session attach";
  return fitPlain(command.length <= width ? command : "/session attach", width);
}

export function compactCommandResultAcknowledgement(text: string, width: number): string {
  return fitPlain(text, width);
}

export function compactProviderLoginAcknowledgement(providerId: "openai" | "anthropic", width: number): string {
  return fitPlain(`${providerId} login in progress · please wait`, width);
}

export function compactTaskContractAcknowledgement(width: number): string {
  return [
    "Task contract ready · resize to review",
    "/task-contract confirm",
    "/task-contract launch",
  ]
    .map((line) => fitPlain(line, width))
    .join("\n");
}

export function compactConnectionRecoveryAcknowledgement(connection: TuiShellState["connection"], width: number): string | undefined {
  if (connection.kind === "connected") return undefined;
  if (connection.kind === "setup-required") return setupRequiredGuidance(width, true);
  return fitPlain("ctrl+r retry · /help", width);
}

export function shouldBlockPendingConfirmationSubmit(text: string, pendingConfirmation: boolean): boolean {
  return pendingConfirmation && text.trim() !== "";
}

export function approvalPendingAcknowledgement(width: number): string {
  return fitPlain("Approval pending · y approve · n reject · ctrl+a review", width);
}

export function shouldBlockConcurrentTurnSubmit(
  text: string,
  working: boolean,
  activeController: AbortController | undefined,
  submitInFlight = false,
): boolean {
  return text.trim() !== "" && !text.trim().startsWith("/") && (working || activeController !== undefined || submitInFlight);
}

export function isCurrentConversationTurnController(
  controller: AbortController,
  activeController: AbortController | undefined,
): boolean {
  return activeController === controller;
}

export function shouldDeferAutomaticProviderSignIn(draft: string): boolean {
  return draft.trim() !== "";
}

export function isCurrentAccountLoginOperation(controller: AbortController, activeController: AbortController | undefined): boolean {
  return activeController === controller && !controller.signal.aborted;
}

export function isCurrentProviderLoginOperation(operationGeneration: number, activeGeneration: number, stopped: boolean): boolean {
  return !stopped && operationGeneration === activeGeneration;
}

export async function persistProviderLoginModelSelection(options: {
  workspacePath: string;
  session: WorkspaceSession | undefined;
  model: string;
  isCurrent: () => boolean;
  save: (session: WorkspaceSession) => Promise<void>;
  setSession: (session: WorkspaceSession) => void;
  setModel: (model: string) => void;
}): Promise<boolean> {
  if (!options.isCurrent()) return false;
  const nextSession = selectWorkspaceModel(options.workspacePath, options.session, options.model);
  if (!options.isCurrent()) return false;
  await options.save(nextSession);
  if (!options.isCurrent()) return false;
  options.setSession(nextSession);
  options.setModel(options.model);
  return true;
}

export function firstAvailableModelIdentity(models: readonly Pick<ModelCatalogEntry, "identity">[]): string | undefined {
  const model = models[0];
  return model === undefined ? undefined : `${model.identity.provider}/${model.identity.id}`;
}

export function shouldHandoffAfterProviderLogin(configuredModel: string | undefined, conversationId: string | undefined): boolean {
  return configuredModel === undefined && conversationId === undefined;
}

export function shouldCancelPendingProviderLogin(pendingProviderLogin: string | undefined): boolean {
  return pendingProviderLogin !== undefined;
}

function shouldConsumeProviderLoginBackgroundInput(active: boolean, data: string): boolean {
  if (!active || matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) return false;
  return (
    isSplashRestoreShortcut(data) ||
    matchesKey(data, "ctrl+k") ||
    matchesKey(data, "ctrl+g") ||
    matchesKey(data, "ctrl+e") ||
    matchesKey(data, "ctrl+r") ||
    matchesKey(data, "ctrl+a")
  );
}

export function shouldConsumePendingProviderLoginBackgroundInput(pendingProviderLogin: string | undefined, data: string): boolean {
  return shouldConsumeProviderLoginBackgroundInput(pendingProviderLogin !== undefined, data);
}

export function shouldConsumeProviderLoginInFlightBackgroundInput(providerLoginInFlight: boolean, data: string): boolean {
  return shouldConsumeProviderLoginBackgroundInput(providerLoginInFlight, data);
}

export function shouldBlockProviderLoginInFlightSubmit(text: string, providerLoginInFlight: boolean): boolean {
  return providerLoginInFlight && text.trim() !== "";
}

export function shouldConsumeAccountLoginSelectingBackgroundInput(
  accountLoginState: "selecting" | "opening" | "waiting" | undefined,
  data: string,
): boolean {
  if (accountLoginState !== "selecting") return false;
  return (
    isSplashRestoreShortcut(data) ||
    matchesKey(data, "ctrl+k") ||
    matchesKey(data, "ctrl+g") ||
    matchesKey(data, "ctrl+e") ||
    matchesKey(data, "ctrl+r") ||
    matchesKey(data, "ctrl+a")
  );
}

export function shouldConsumeAccountLoginBackgroundInput(
  accountLoginState: "selecting" | "opening" | "waiting" | undefined,
  isCtrlC: boolean,
  isEscape: boolean,
  isAltC: boolean,
): boolean {
  if (accountLoginState === undefined || accountLoginState === "selecting" || isCtrlC) return false;
  if (accountLoginState === "opening") return !isEscape;
  return !isEscape && !isAltC;
}

export function compactModelListAcknowledgement(identities: readonly string[], width: number, unavailableLabel?: string): string {
  if (identities.length === 0) return fitPlain(unavailableLabel === undefined ? "No models available · retry /models list" : "Catalog unavailable · retry /models", width);
  const identity = identities[0]!;
  const command = `/model use --model ${identity}`;
  if (command.length <= width) return command;
  if (width <= 0) return "";
  const lines: string[] = [];
  for (let offset = 0; offset < identity.length; offset += width) lines.push(identity.slice(offset, offset + width));
  return lines.join("\n");
}

export function compactConversationAcknowledgement(
  conversation: Pick<ConversationTranscriptState, "assistantText" | "status" | "statusMessage">,
  width: number,
): string {
  const content = (conversation.assistantText || conversation.statusMessage || (conversation.status === "streaming" ? "Waiting for response…" : conversation.status))
    .replace(/\s+/g, " ")
    .trim();
  const label = conversation.status === "streaming" ? "Maestro · streaming" : `Maestro · ${conversation.status}`;
  return fitPlain(`${label}: ${content}`, width);
}

export function shouldIgnoreEmptySubmit(text: string, pendingProviderLogin: string | undefined): boolean {
  return pendingProviderLogin === undefined && text.trim() === "";
}

export { createTranscriptClearBoundary, executeBasicShellCommand, latestCopyableTranscriptText };
export type { BasicShellCommandContext, BasicShellCommandName } from "./basic-shell.js";

export { taskContractDraftForConversation };

export async function hydrateOrganizationOnReconnect(
  state: Pick<TuiShellState, "organization">,
  client: Pick<ApiClient, "getOrganization">,
): Promise<void> {
  state.organization = { kind: "loading" };
  state.organization = await hydrateOrganizationState(client);
}

/** Prefer the explicitly configured model, falling back to the persisted session selection. */
export function resolveConfiguredModel(environmentModel: string | undefined, sessionModel: string | undefined): string | undefined {
  return environmentModel?.trim() || sessionModel;
}

export function handleConversationStreamEvent(options: {
  conversation: ConversationTranscriptState;
  event: ConversationEvent;
  dismissSplash: () => void;
  onCompactOutcome?: (conversation: ConversationTranscriptState) => void;
  render: () => void;
}): { conversation: ConversationTranscriptState; terminal: boolean } {
  const conversation = applyConversationEvent(options.conversation, options.event);
  options.dismissSplash();
  options.onCompactOutcome?.(conversation);
  options.render();
  return { conversation, terminal: isTerminalConversationEvent(conversation, options.event) };
}

export function applyHydratedConversation(
  hydrated: ConversationTranscriptState,
  goalId: string | null | undefined,
  callbacks: {
    setConversation: (conversation: ConversationTranscriptState) => void;
    setDraft: (draft: TaskContract) => void;
    showDraft: (content: string) => void;
  },
): void {
  callbacks.setConversation(hydrated);
  const priorDraft = priorTaskContractDraft(hydrated.messages, goalId);
  if (priorDraft !== undefined) {
    callbacks.setDraft(priorDraft);
    callbacks.showDraft(JSON.stringify(priorDraft));
  }
}

export function isAutomaticProviderSignInProjectEligible(projectKind: "attached" | "unavailable"): boolean {
  return projectKind === "attached";
}

export function shouldOfferAutomaticProviderSignIn(
  models: readonly Pick<ModelCatalogEntry, "identity">[],
  configuredModel: string | undefined,
): boolean {
  const selectedModel = configuredModel?.trim();
  if (models.length === 0) return selectedModel === undefined || selectedModel === "";
  if (selectedModel === undefined || selectedModel === "") return false;
  return !models.some((model) => `${model.identity.provider}/${model.identity.id}` === selectedModel);
}

export function shouldRetryAutomaticProviderSignIn(previousRows: number, currentRows: number): boolean {
  return previousRows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT && currentRows >= COMPACT_PROVIDER_LOGIN_MIN_HEIGHT;
}

/** Prevent a dismissed or already-presented automatic offer from nagging again. */
export function createAutomaticProviderSignInGate(): { claim: () => boolean } {
  let claimed = false;
  return {
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
}

export function isProviderLoginActive(
  pendingProviderLogin: "openai" | "anthropic" | undefined,
  providerLoginInFlight: boolean,
  accountLoginSelection: AccountLoginProviderSelection | undefined,
): boolean {
  return pendingProviderLogin !== undefined || providerLoginInFlight || accountLoginSelection !== undefined;
}

export async function runAutomaticProviderSignInOffer(options: {
  client: Pick<ApiClient, "listModels">;
  getConfiguredModel: () => string | undefined;
  gate: { claim: () => boolean };
  isCurrent: () => boolean;
  isManualLoginActive: () => boolean;
  canOffer?: () => boolean;
  onOffer: () => void;
}): Promise<void> {
  if (!options.isCurrent() || options.isManualLoginActive()) return;
  let models: readonly Pick<ModelCatalogEntry, "identity">[];
  try {
    models = await options.client.listModels();
  } catch {
    return;
  }
  if (!options.isCurrent() || options.isManualLoginActive() || !shouldOfferAutomaticProviderSignIn(models, options.getConfiguredModel()))
    return;
  if (options.canOffer !== undefined && !options.canOffer()) return;
  if (!options.gate.claim() || !options.isCurrent() || options.isManualLoginActive()) return;
  options.onOffer();
}
import type { LocalBootstrapStepEvent } from "./local-bootstrap.js";
import { createTuiRuntime } from "./runtime.js";

export async function startInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, true);
  const liveState: TuiShellState = {
    workspace: { cwd: options.cwd, gitRoot: options.cwd },
    connection: { kind: "connecting" },
    goal: { kind: "empty" },
    workers: { kind: "empty" },
    approvals: { kind: "empty" },
    budget: { kind: "empty" },
    organization: { kind: "empty" },
  };
  const splash = createSplashController();
  const startupAbortController = new AbortController();
  let startupCancelled = false;
  let startupSettled = false;
  let resolveStartupCancellation: (() => void) | undefined;
  const startupCancellation = new Promise<void>((resolve) => {
    resolveStartupCancellation = resolve;
  });
  const updateSetupStep = (event: LocalBootstrapStepEvent): void => {
    if (startupCancelled) return;
    const steps = [...(liveState.setupSteps ?? [])];
    const existing = steps.findIndex((step) => step.step === event.step);
    if (existing === -1) steps.push(event);
    else steps[existing] = event;
    liveState.setupSteps = steps;
    liveState.connection =
      event.status === "failed"
        ? { kind: "setup-required", message: event.message ?? `${event.step} failed` }
        : { kind: "setup-required", message: `Local setup · ${event.step}` };
    tui.requestRender(true);
    options.onSetupStep?.(event);
  };
  const statusRegion = createStatusRegion({ state: liveState, height: () => terminal.rows, splash });
  tui.setLayoutRoot(new VStack([{ component: statusRegion, basis: "auto", shrink: 0, minSize: 1 }]));
  const removeStartupInput = tui.addInputListener((data) => {
    if (startupSettled || !isStartupCancellationInput(data)) return undefined;
    startupCancelled = true;
    startupAbortController.abort();
    tui.stop();
    resolveStartupCancellation?.();
    return { consume: true };
  });
  let tuiStarted = false;
  const startTui = (): void => {
    if (tuiStarted) return;
    tuiStarted = true;
    tui.start();
  };
  startTui();
  let initialized: Awaited<ReturnType<typeof initializeTui>>;
  const initialization = initializeTui({ ...options, signal: startupAbortController.signal, onSetupStep: updateSetupStep });
  try {
    const result = await Promise.race([initialization, startupCancellation.then(() => undefined)]);
    startupSettled = true;
    removeStartupInput();
    if (result === undefined) {
      void initialization.catch(() => undefined);
      return 0;
    }
    initialized = result;
  } catch (error) {
    startupSettled = true;
    removeStartupInput();
    tui.stop();
    throw error;
  }
  Object.assign(liveState, initialized.state);
  let { workspace, startupError, connection, session, project, projectDiscoveryNotice, client } = initialized;
  const sessionWorkspacePath = workspaceIdentity(workspace);
  const state = liveState;
  const syncProjectPresentation = (): void => {
    state.project = project.kind === "attached" ? { kind: "attached" } : { kind: "unavailable", guidance: projectDiscoveryNotice ?? project.reason };
  };
  return await new Promise<number>((resolve) => {
    const editor = new SecretEditor(tui, editorTheme, { paddingX: 2, autocompleteMaxVisible: 6 });
    const inputPanel = new Box(1, 0, tuiTheme.inputSurface);
    let compactReview: string | undefined;
    let compactHelp: string | undefined;
    let compactModelList: { identities: string[]; unavailableLabel?: string } | undefined;
    let compactCommandResult: string | undefined;
    let compactConversationResult: string | undefined;
    let compactTaskContractReview = false;
    let compactProjectNotice = projectDiscoveryNotice;
    let lastRenderedTerminalRows = terminal.rows;
    let offerAutomaticProviderSignIn = (): void => undefined;
    const inputLabel = createDynamicRegion((width) => {
      const shouldRetryOffer = shouldRetryAutomaticProviderSignIn(lastRenderedTerminalRows, terminal.rows);
      lastRenderedTerminalRows = terminal.rows;
      if (shouldRetryOffer) queueMicrotask(offerAutomaticProviderSignIn);
      return [
        tuiTheme.muted(
          compactHelp !== undefined && terminal.rows < 16
            ? fitPlain(compactHelp, width)
            : compactReview !== undefined && terminal.rows < 16
              ? fitPlain(compactReview, width)
              : terminal.rows < 16 && state.connection.kind !== "connected"
                ? compactConnectionRecoveryAcknowledgement(state.connection, width) ?? renderInputPlaceholder(state, width, terminal.rows < 16)
                : providerLoginInFlightProvider !== undefined && terminal.rows < 16
                  ? compactProviderLoginAcknowledgement(providerLoginInFlightProvider, width)
                  : compactModelList !== undefined && terminal.rows < 16
                    ? compactModelListAcknowledgement(compactModelList.identities, width, compactModelList.unavailableLabel)
                    : terminal.rows < 16 && project.kind !== "attached"
                      ? compactProjectAttachmentNotice(compactProjectNotice, width)
                      : compactTaskContractReview && terminal.rows < 16
                      ? compactTaskContractAcknowledgement(width)
                      : compactConversationResult !== undefined && terminal.rows < 16
                        ? compactConversationResult
                        : compactCommandResult !== undefined && terminal.rows < 16
                          ? compactCommandResultAcknowledgement(compactCommandResult, width)
                          : renderInputPlaceholder(state, width, terminal.rows < 16),
        ),
      ];
    });
    inputPanel.addChild(inputLabel);
    inputPanel.addChild(editor);
    const composer = new FramedComposer(inputPanel);
    const footer = new Text("", 0, 0);
    const header = new ConversationViewport();
    const registry = createCommandRegistry();
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider(createCommandAutocompleteItems(registry), workspace.cwd));
    let conversation: ConversationTranscriptState = createConversationTranscript();
    let draftedTaskContract: TaskContract | undefined;
    let renderedDraftIdentity: string | undefined;
    let activity: GoalEvent[] = [];
    let visibleActivityStart = 0;
    let recovery: RecoverySummary = reconcileTuiSession(sessionWorkspacePath, session);
    let pendingConfirmation: { summary: ApprovalDialogSummary; resolve: (decision: ConfirmationResult) => void } | undefined;
    const syncPendingDecisionState = (): void => {
      const goalId = selectedConversationGoalId(state.goal, session?.goalId);
      state.pendingDecisions = pendingDecisionsForView({
        goalId,
        activity,
        ...(pendingConfirmation === undefined ? {} : { pendingConfirmation }),
      });
    };
    let activityStarted = false;
    let activityHydrationGeneration = 0;
    const activityHistoryBoundary = createTranscriptClearBoundary();
    const conversationDisplayBoundary = createTranscriptClearBoundary();
    let activityController: AbortController | undefined;
    let conversationTurnController: AbortController | undefined;
    let naturalSubmitInFlight = false;
    const conversationTurnBoundary = createConversationTurnBoundary();
    let pendingProviderLogin: "openai" | "anthropic" | undefined;
    let providerLoginInFlight = false;
    let providerLoginInFlightProvider: "openai" | "anthropic" | undefined;
    let providerLoginGeneration = 0;
    let accountLoginSelection: AccountLoginProviderSelection | undefined;
    let accountLoginState: "selecting" | "opening" | "waiting" | undefined;
    let accountLoginController: AbortController | undefined;
    let accountLoginId: string | undefined;
    let accountLoginUrl: string | undefined;
    let connectionGeneration = client === undefined ? 0 : 1;
    let loginInteractionGeneration = 0;
    const automaticProviderSignInGate = createAutomaticProviderSignInGate();
    const syncModelState = (): void => {
      const model = resolveConfiguredModel(options.env.MAESTRO_MODEL, session?.model);
      if (model === undefined) delete state.model;
      else state.model = model;
    };
    const decisionRegion = createDecisionRegion({ state, height: () => terminal.rows });
    const noticeRegion = createDynamicRegion(() => {
      if (terminal.rows < 16 && accountLoginSelection === undefined) return [];
      const lines = terminal.rows < 16 ? [] : [...renderRecoveryBanner(recovery, terminal.columns)];
      if (accountLoginSelection !== undefined && accountLoginState !== undefined)
        lines.push(
          ...renderProviderLoginDialog(terminal.columns, accountLoginSelection, accountLoginState, accountLoginUrl, terminal.rows < 16),
        );
      return lines;
    });
    header.setOrderedStreamRenderer(() => renderUnifiedStreamEntries(conversation, activity.slice(visibleActivityStart), terminal.columns));
    const render = () => {
      syncPendingDecisionState();
      footer.setText(terminal.rows < 16 ? "" : renderTuiFooter(terminal.columns, state));
      tui.requestRender(true);
    };
    const append = (line: string | TranscriptLine) => {
      splash.dismiss();
      const semanticLine: TranscriptLine = typeof line === "string" ? { kind: "system", text: line } : line;
      if (terminal.rows < 16) {
        compactConversationResult = undefined;
        compactTaskContractReview = semanticLine.text.includes("/task-contract confirm") && semanticLine.text.includes("/task-contract launch");
        compactCommandResult = compactTaskContractReview ? undefined : semanticLine.text;
      }
      const next = addConversationMessage(conversation, "system", semanticLine.text, semanticLine.kind);
      conversation = { ...next, messages: next.messages.slice(-80) };
      render();
    };
    const appendError = (text: string): void => append({ kind: "error", text });
    const appendSuccess = (text: string): void => append({ kind: "success", text });
    const appendWarning = (text: string): void => append({ kind: "warning", text });
    const handoffToAvailableModel = async (loginLabel: string, isCurrent: () => boolean = () => true): Promise<void> => {
      if (client === undefined || !shouldHandoffAfterProviderLogin(resolveConfiguredModel(options.env.MAESTRO_MODEL, session?.model), session?.conversationId)) return;
      try {
        const models = await client.listModels();
        if (!isCurrent()) return;
        const selectedModel = firstAvailableModelIdentity(models);
        if (selectedModel === undefined) {
          appendWarning(`${loginLabel} complete, but no model is available. Run /models list, then /model use --model provider/model.`);
        } else {
          const persisted = await persistProviderLoginModelSelection({
            workspacePath: sessionWorkspacePath,
            session,
            model: selectedModel,
            isCurrent,
            save: saveWorkspaceSession,
            setSession: (nextSession) => {
              session = nextSession;
            },
            setModel: (model) => {
              state.model = model;
            },
          });
          if (!persisted) return;
          appendSuccess(`Model selected after ${loginLabel}: ${selectedModel}`);
        }
      } catch (error) {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : "request failed";
        appendWarning(`${loginLabel} complete, but model discovery failed: ${message}. Run /models list, then /model use --model provider/model.`);
      }
    };
    const showDraftIfPresent = (content: string): void => {
      const presentation = draftForPresentation({
        content,
        goalId: session?.goalId,
        current: draftedTaskContract,
        renderedIdentity: renderedDraftIdentity,
      });
      if (presentation === undefined) return;
      draftedTaskContract = presentation.draft;
      if (!presentation.shouldRender) return;
      renderedDraftIdentity = presentation.identity;
      append({ kind: "system", text: renderTaskContractDraft(presentation.draft).join("\n") });
    };
    let flashmobMode = false;
    let flashmobAnimationId = 0;
    const animateFlashmobMode = async (enabled: boolean): Promise<void> => {
      const animationId = ++flashmobAnimationId;
      const from = getModeAccentProgress();
      const to = enabled ? 1 : 0;
      flashmobMode = enabled;
      state.mode = enabled ? "flashmob" : "maestro";
      const completed = await animateAccentProgress({
        from,
        to,
        isCurrent: () => animationId === flashmobAnimationId,
        setProgress: setModeAccentProgress,
        render,
        wait: (milliseconds) => new Promise<void>((resolveFrame) => setTimeout(resolveFrame, milliseconds)),
      });
      if (!completed) return;
      appendSuccess(`Flashmob ${enabled ? "enabled" : "disabled"} · ${enabled ? "blue" : "Warm Earth"} accent`);
    };
    let dashboardRefreshGeneration = 0;
    const invalidateDashboardRefreshes = (): void => {
      dashboardRefreshGeneration += 1;
    };
    const refreshDashboard = async () => {
      const generation = ++dashboardRefreshGeneration;
      if (client === undefined || project.kind !== "attached") return;
      const requestClient = client;
      const requestProjectId = project.projectId;
      const requestGoalId = session?.goalId;
      await refreshDashboardState({
        client: requestClient,
        projectId: requestProjectId,
        ...(requestGoalId === undefined ? {} : { goalId: requestGoalId }),
        readDashboard,
        isCurrent: () =>
          !stopped &&
          generation === dashboardRefreshGeneration &&
          client === requestClient &&
          project.kind === "attached" &&
          project.projectId === requestProjectId &&
          session?.goalId === requestGoalId,
        setDashboardState: (dashboardState) => {
          state.goal = dashboardState.goal;
          state.workers = dashboardState.workers;
          state.budget = dashboardState.budget;
        },
        setRecovery: (dashboard) => {
          recovery = reconcileTuiSession(sessionWorkspacePath, session, {
            ...(dashboard.selectedGoal === undefined ? {} : { goalState: dashboard.selectedGoal.state }),
            ...(dashboard.workerCount === undefined ? {} : { activeWorkers: dashboard.workerCount }),
          });
        },
        render,
      });
    };
    const hydrateActivity = async (
      projectId: string,
      generation: number,
      historyGeneration = activityHistoryBoundary.capture(),
    ): Promise<void> => {
      if (client === undefined) return;
      await hydrateActivityHistory({
        client,
        projectId,
        readActivity: () => activity,
        setActivity: (nextActivity) => {
          activity = nextActivity;
        },
        isCurrent: () =>
          generation === activityHydrationGeneration &&
          activityHistoryBoundary.isCurrent(historyGeneration) &&
          project.kind === "attached" &&
          project.projectId === projectId,
        onWarning: (message) => appendWarning(message),
        render,
      });
    };

    const streamActivity = async (signal: AbortSignal, projectId: string, generation: number) => {
      if (client === undefined) return;
      await runLiveActivityStream({
        client,
        projectId,
        signal,
        readState: () => ({ activity, session }),
        workspacePath: sessionWorkspacePath,
        isCurrent: () => generation === activityHydrationGeneration && project.kind === "attached" && project.projectId === projectId,
        dismissSplash: () => splash.dismiss(),
        setActivity: (nextActivity) => {
          activity = nextActivity;
        },
        setSession: (nextSession) => {
          session = nextSession;
        },
        saveSession: saveWorkspaceSession,
        append,
        render,
      });
    };

    let conversationStreamController: AbortController | undefined;
    let conversationHydration: Promise<void> = Promise.resolve();
    let conversationHydrationGeneration = 0;
    const streamConversation = async (
      conversationId: string,
      projectId: string,
      controller: AbortController,
      displayGeneration = conversationDisplayBoundary.capture(),
    ): Promise<void> => {
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
          onReconnect: (attempt, maxAttempts) =>
            append({ kind: "warning", text: `Conversation stream reconnecting (${attempt}/${maxAttempts})` }),
        })) {
          if (
            signal.aborted ||
            !conversationDisplayBoundary.isCurrent(displayGeneration) ||
            session?.conversationId !== conversationId ||
            project.kind !== "attached" ||
            project.projectId !== projectId
          )
            return;
          const handled = handleConversationStreamEvent({
            conversation,
            event,
            dismissSplash: () => splash.dismiss(),
            onCompactOutcome: (nextConversation) => {
              if (terminal.rows < 16) {
                compactConversationResult = compactConversationAcknowledgement(nextConversation, terminal.columns);
                compactCommandResult = undefined;
                compactTaskContractReview = false;
              }
            },
            render,
          });
          conversation = handled.conversation;
          if (handled.terminal) {
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
        const hydrated = await loadConversationHistory({
          client,
          conversationId,
          projectId,
          isCurrent: () =>
            generation === conversationHydrationGeneration &&
            session?.conversationId === conversationId &&
            project.kind === "attached" &&
            project.projectId === projectId,
        });
        if (hydrated === undefined) return;
        applyHydratedConversation(hydrated, session?.goalId, {
          setConversation: (nextConversation) => {
            conversation = nextConversation;
          },
          setDraft: (draft) => {
            draftedTaskContract = draft;
          },
          showDraft: showDraftIfPresent,
        });
        splash.dismiss();
        render();
      } catch (error) {
        if (generation === conversationHydrationGeneration)
          appendError(`Conversation history unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
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
      visibleActivityStart = 0;
      state.pendingDecisions = [];
      const generation = ++activityHydrationGeneration;
      const projectId = project.kind === "attached" ? project.projectId : undefined;
      if (projectId !== undefined)
        void hydrateActivity(projectId, generation).then(() => {
          if (generation === activityHydrationGeneration) startActivity();
        });
    };
    const applySuccessfulRetryHandoff = async (sessionResult: typeof session, notice: string | undefined): Promise<void> => {
      session = sessionResult;
      await hydrateOrganizationOnReconnect(state, client!);
      state.connection = { kind: "connected" };
      recovery = reconcileTuiSession(sessionWorkspacePath, session);
      appendSuccess("Control Plane connected.");
      if (notice !== undefined) appendWarning(notice);
      void refreshDashboard();
      restartActivity();
      void offerAutomaticProviderSignIn();
    };
    const retryConnection = async () => {
      connectionGeneration += 1;
      invalidateDashboardRefreshes();
      appendWarning("Retrying Maestro startup checks…");
      if (startupError !== undefined) {
        const retriedWorkspace = await resolveRetryWorkspace(options.cwd);
        if (retriedWorkspace.kind === "error") {
          startupError = retriedWorkspace.message;
          state.connection = { kind: "error", message: `Workspace unavailable: ${startupError}` };
          appendError(`Startup retry failed: ${startupError}`);
          return;
        }
        workspace = retriedWorkspace.workspace;
        state.workspace = workspace;
        startupError = undefined;
      }
      if (connection.kind !== "configured") {
        if (shouldAutoBootstrapLocal(options.env)) {
          connection = await resolveLocalConnection({
            env: options.env,
            ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
            onStep: updateSetupStep,
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
        project = discoverWorkspaceProject(sessionWorkspacePath, session);
        projectDiscoveryNotice = undefined;
        syncProjectPresentation();
        const reconnectedProject = await reconnectWorkspaceProject({
          workspacePath: sessionWorkspacePath,
          session,
          client,
          saveSession: saveWorkspaceSession,
          syncModelState,
          onDiscovered: (discovered) => {
            project = discovered;
            if (discovered.kind === "unavailable") projectDiscoveryNotice = discovered.reason;
            syncProjectPresentation();
          },
          onSessionAttached: (attachedSession) => {
            session = attachedSession;
          },
        });
        await applySuccessfulRetryHandoff(reconnectedProject.session, projectDiscoveryNotice);
        compactProjectNotice = project.kind === "attached" ? undefined : projectDiscoveryNotice;
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
      if (client === undefined) {
        appendWarning("Account login is unavailable until the Control Plane is connected.");
        cancelAccountLogin();
        return;
      }
      if (accountLoginSelection === 1) {
        appendWarning("Claude Pro / Max account login is unavailable until Anthropic approves a public OAuth integration.");
        cancelAccountLogin();
        return;
      }
      accountLoginState = "opening";
      render();
      const controller = new AbortController();
      accountLoginController = controller;
      try {
        const login = await client.startAccountLogin();
        if (!isCurrentAccountLoginOperation(controller, accountLoginController)) return;
        accountLoginId = login.loginId;
        accountLoginUrl = login.authUrl;
        accountLoginState = "waiting";
        render();
        const status = await waitForAccountLogin({
          client,
          loginId: login.loginId,
          authUrl: login.authUrl,
          signal: controller.signal,
          openExternalUrl: options.io.openExternalUrl ?? openExternalUrl,
          onOpenFailure: (url) => append(`Open this URL in your browser to sign in: ${url}`),
          timeoutMs: Number(options.env.MAESTRO_LOGIN_TIMEOUT_MS ?? "120000"),
          pollMs: Number(options.env.MAESTRO_LOGIN_POLL_MS ?? "500"),
        });
        if (!isCurrentAccountLoginOperation(controller, accountLoginController) || status === undefined) return;
        if (status.state === "succeeded") {
          appendSuccess("Account login complete: openai-codex");
          await handoffToAvailableModel("Account login");
          void refreshDashboard();
        } else if (status.state === "failed") appendError(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
        else appendWarning(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "request failed";
          const detail = error instanceof ApiError && error.detail !== undefined ? ` (${error.detail})` : "";
          appendError(`Account login failed: ${message}${detail}`);
        }
      } finally {
        if (accountLoginController === controller) {
          accountLoginController = undefined;
          accountLoginId = undefined;
          accountLoginUrl = undefined;
          accountLoginSelection = undefined;
          accountLoginState = undefined;
          editor.hidden = false;
          render();
        }
      }
    };
    offerAutomaticProviderSignIn = (): void => {
      if (client === undefined) return;
      const candidateClient = client;
      const candidateGeneration = connectionGeneration;
      const candidateLoginInteractionGeneration = loginInteractionGeneration;
      void runAutomaticProviderSignInOffer({
        client: candidateClient,
        getConfiguredModel: () => resolveConfiguredModel(options.env.MAESTRO_MODEL, session?.model),
        gate: automaticProviderSignInGate,
        isCurrent: () =>
          !stopped &&
          client === candidateClient &&
          connectionGeneration === candidateGeneration &&
          loginInteractionGeneration === candidateLoginInteractionGeneration &&
          state.connection.kind === "connected" &&
          isAutomaticProviderSignInProjectEligible(project.kind),
        isManualLoginActive: () => isProviderLoginActive(pendingProviderLogin, providerLoginInFlight, accountLoginSelection),
        canOffer: () => terminal.rows >= COMPACT_PROVIDER_LOGIN_MIN_HEIGHT && !shouldDeferAutomaticProviderSignIn(editor.getText()),
        onOffer: () => {
          if (terminal.rows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT || shouldDeferAutomaticProviderSignIn(editor.getText())) return;
          accountLoginSelection = 0;
          accountLoginState = "selecting";
          editor.hidden = true;
          editor.setText("");
          render();
        },
      });
    };

    const submit = async (text: string) => {
      if (shouldIgnoreEmptySubmit(text, pendingProviderLogin)) return;
      if (shouldBlockProviderLoginInFlightSubmit(text, providerLoginInFlight)) {
        editor.setText(text);
        appendWarning("Provider login in progress · please wait");
        render();
        return;
      }
      if (shouldBlockPendingConfirmationSubmit(text, pendingConfirmation !== undefined)) {
        editor.setText(text);
        appendWarning(approvalPendingAcknowledgement(terminal.columns));
        render();
        return;
      }
      if (shouldBlockConcurrentTurnSubmit(text, state.working === true, conversationTurnController, naturalSubmitInFlight)) {
        editor.setText(text);
        appendWarning("Turn in progress · Esc to stop");
        render();
        return;
      }
      if (text.trim() !== "") splash.dismiss();
      if (pendingProviderLogin !== undefined) {
        const providerId = pendingProviderLogin;
        const operationGeneration = ++providerLoginGeneration;
        pendingProviderLogin = undefined;
        providerLoginInFlight = true;
        providerLoginInFlightProvider = providerId;
        editor.hidden = false;
        editor.setText("");
        render();
        const isCurrentProviderLogin = (): boolean =>
          isCurrentProviderLoginOperation(operationGeneration, providerLoginGeneration, stopped);
        try {
          if (client === undefined) {
            appendWarning("Provider login is unavailable until the Control Plane is connected.");
          } else {
            await client.loginProvider({ providerId, authMode: "api-key", secret: text });
            if (!isCurrentProviderLogin()) return;
            appendSuccess(`Provider login complete: ${providerId} API key stored by the model gateway.`);
            await handoffToAvailableModel("Provider login", isCurrentProviderLogin);
          }
        } catch (error) {
          if (isCurrentProviderLogin()) appendError(`Provider login failed: ${error instanceof Error ? error.message : "request failed"}`);
        } finally {
          if (isCurrentProviderLogin()) {
            providerLoginInFlight = false;
            providerLoginInFlightProvider = undefined;
            render();
          }
        }
        return;
      }
      let ownsNaturalSubmit = false;
      let conversationTurnGeneration: number | undefined;
      try {
        const parsed = parseInput(text);
        if (parsed.kind === "natural-language") {
          naturalSubmitInFlight = true;
          ownsNaturalSubmit = true;
        }
        if (
          parsed.kind === "command" &&
          parsed.action === undefined &&
          Object.keys(parsed.options).length === 0 &&
          (parsed.name === "clear" ||
            parsed.name === "exit" ||
            parsed.name === "quit" ||
            parsed.name === "version" ||
            parsed.name === "copy")
        ) {
          await executeBasicShellCommand(parsed.name, {
            clearTranscript: () => {
              activityHistoryBoundary.clear();
              conversationTurnBoundary.invalidate();
              conversationDisplayBoundary.clear();
              conversationStreamController?.abort();
              conversationStreamController = undefined;
              conversationHydrationGeneration += 1;
              conversationHydration = Promise.resolve();
              conversation = createConversationTranscript();
              visibleActivityStart = activity.length;
              render();
            },
            stop,
            getLatestTranscriptText: () => latestCopyableTranscriptText(conversation),
            copyToClipboard: options.io.copyToClipboard ?? copyToClipboard,
            write: append,
            version: MAESTRO_VERSION,
          });
        } else if (parsed.kind === "command" && parsed.name === "help") {
          compactHelp = terminal.rows < 16 ? compactHelpAcknowledgement(terminal.columns) : undefined;
          dispatchCommandPaletteInput("help", append);
        } else if (parsed.kind === "command" && parsed.name === "login" && parsed.action === undefined) {
          if (terminal.rows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT) {
            appendWarning(`Provider sign-in chooser needs at least ${COMPACT_PROVIDER_LOGIN_MIN_HEIGHT} terminal rows.`);
          } else {
            loginInteractionGeneration += 1;
            accountLoginSelection = 0;
            accountLoginState = "selecting";
            editor.hidden = true;
            editor.setText("");
            render();
          }
        } else if (parsed.kind === "command" && parsed.name === "login" && parsed.action === "openai-codex") {
          if (terminal.rows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT) {
            appendWarning(`Provider sign-in chooser needs at least ${COMPACT_PROVIDER_LOGIN_MIN_HEIGHT} terminal rows.`);
          } else {
            loginInteractionGeneration += 1;
            accountLoginSelection = 0;
            accountLoginState = "selecting";
            editor.hidden = true;
            editor.setText("");
            render();
            void startAccountLogin();
          }
        } else if (parsed.kind === "command" && parsed.name === "login" && (parsed.action === "openai" || parsed.action === "anthropic")) {
          if (client === undefined) {
            appendWarning("Provider login is unavailable until the Control Plane is connected.");
          } else {
            loginInteractionGeneration += 1;
            pendingProviderLogin = parsed.action;
            editor.hidden = true;
            editor.setText("");
            append(`Enter the ${parsed.action} API key and press Enter. Input is hidden and never saved to session history.`);
            render();
          }
        } else if (parsed.kind === "command" && parsed.name === "logout" && parsed.action === "openai-codex") {
          if (client === undefined) appendWarning("Account logout is unavailable until the Control Plane is connected.");
          else {
            invalidateDashboardRefreshes();
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
            invalidateDashboardRefreshes();
            conversationTurnBoundary.invalidate();
            conversationStreamController?.abort();
            conversationStreamController = undefined;
            conversationHydrationGeneration += 1;
            conversationHydration = Promise.resolve();
            conversation = createConversationTranscript();
            draftedTaskContract = undefined;
            renderedDraftIdentity = undefined;
            session = startNewConversationSession(sessionWorkspacePath, session);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(sessionWorkspacePath, session);
            appendSuccess("New Concertmaster conversation started. Durable Goal state was preserved.");
          } else if (parsed.action === "attach") {
            invalidateDashboardRefreshes();
            conversationTurnBoundary.invalidate();
            conversationStreamController?.abort();
            conversationStreamController = undefined;
            conversationHydrationGeneration += 1;
            conversationHydration = Promise.resolve();
            conversation = createConversationTranscript();
            draftedTaskContract = undefined;
            renderedDraftIdentity = undefined;
            const requestedProjectId = parsed.options["project-id"];
            const requestedProjectIndex = parsed.options["project-index"];
            const current = await loadWorkspaceSession(sessionWorkspacePath);
            if (typeof requestedProjectId === "string" && requestedProjectId.trim() !== "") {
              session = attachWorkspaceSession(sessionWorkspacePath, current, requestedProjectId);
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
              session = attachWorkspaceSession(sessionWorkspacePath, current, projects[index - 1]!);
              syncModelState();
              await saveWorkspaceSession(session);
            } else if (current?.projectId !== undefined) {
              session = current;
              syncModelState();
            } else if (client !== undefined) {
              const discovered = await discoverWorkspaceProjectFromControlPlane({ workspacePath: sessionWorkspacePath, session: current, client });
              if (discovered.kind !== "attached") {
                appendWarning(discovered.reason);
                return;
              }
              session = attachWorkspaceSession(sessionWorkspacePath, current, discovered.projectId);
              syncModelState();
              await saveWorkspaceSession(session);
            } else {
              appendWarning("Session attach requires a connected Control Plane or --project-id.");
              return;
            }
            project = discoverWorkspaceProject(sessionWorkspacePath, session);
            projectDiscoveryNotice = undefined;
            compactProjectNotice = undefined;
            syncProjectPresentation();
            recovery = reconcileTuiSession(sessionWorkspacePath, session);
            append(renderRecoveryBanner(recovery, terminal.columns).join(" · "));
            void refreshDashboard();
            restartActivity();
            if (project.kind === "attached") {
              const generation = ++conversationHydrationGeneration;
              conversationHydration = hydrateConversation(session?.conversationId, project.projectId, generation);
              void offerAutomaticProviderSignIn();
            }
          } else if (parsed.action === "list") {
            const current = await loadWorkspaceSession(sessionWorkspacePath);
            append(
              current === undefined
                ? "Session: no saved workspace session"
                : renderRecoveryBanner(reconcileTuiSession(sessionWorkspacePath, current), terminal.columns).join(" · "),
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
            invalidateDashboardRefreshes();
            const selected = await client.getGoal(requestedGoalId, { projectId: project.projectId });
            if (selected.projectId !== project.projectId) throw new Error("Selected Goal is bound to another project");
            const current = await loadWorkspaceSession(sessionWorkspacePath);
            session = selectWorkspaceGoal(sessionWorkspacePath, current ?? session, selected.goalId);
            await saveWorkspaceSession(session);
            recovery = reconcileTuiSession(sessionWorkspacePath, session, { goalState: selected.state });
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
        } else if (
          parsed.kind === "command" &&
          (parsed.name === "models" || parsed.name === "model") &&
          (parsed.action === undefined || parsed.action === "list")
        ) {
          if (client === undefined) {
            const unavailableLabel = "Model catalog unavailable";
            appendWarning("Model catalog unavailable until the Control Plane is connected.");
            compactModelList = terminal.rows < 16 ? { identities: [], unavailableLabel } : undefined;
          } else {
            try {
              const models = await client.listModels();
              const identities = models.map((model) => `${model.identity.provider}/${model.identity.id}`);
              append(identities.length === 0 ? "No models are currently available." : `Models: ${identities.join(" · ")}`);
              compactModelList = terminal.rows < 16 ? { identities } : undefined;
            } catch (error) {
              const message = `Model catalog unavailable: ${error instanceof Error ? error.message : "request failed"}`;
              appendError(message);
              compactModelList = terminal.rows < 16 ? { identities: [], unavailableLabel: "Model catalog unavailable" } : undefined;
            }
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
              session = selectWorkspaceModel(sessionWorkspacePath, session, requestedModel);
              await saveWorkspaceSession(session);
              state.model = requestedModel;
              appendSuccess(`Selected model: ${requestedModel}`);
            }
          }
        } else if (parsed.kind === "command" && parsed.name === "conversation" && parsed.action === "cancel") {
          if (client === undefined || project.kind !== "attached") {
            appendWarning("Conversation cancellation is unavailable until a workspace project is attached.");
          } else {
            const requestedConversationId = parsed.options["conversation-id"];
            if (requestedConversationId === session?.conversationId) conversationTurnController?.abort();
            const cancelResult = await executeWriteCommand(
              {
                client,
                projectId: project.projectId,
                ...(session?.goalId === undefined ? {} : { goalId: session.goalId }),
                confirm,
              },
              parsed,
            );
            append(`${cancelResult.title}: ${cancelResult.lines.join(" · ")}`);
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
            const writeContext = {
              client,
              projectId: project.projectId,
              ...(session?.goalId === undefined ? {} : { goalId: session.goalId }),
              confirm,
            } as Parameters<typeof executeWriteCommand>[0];
            const selectedModel = resolveConfiguredModel(options.env.MAESTRO_MODEL, session?.model);
            if (selectedModel !== undefined) writeContext.model = selectedModel;
            invalidateDashboardRefreshes();
            const writeResult = await dispatchInteractiveWriteCommand(writeContext, parsed);
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
          } else {
            if (session === undefined) {
              appendError("Concertmaster requires an attached workspace session.");
              return;
            }
            const configuredModel = resolveConfiguredModel(options.env.MAESTRO_MODEL, session.model);
            if (session.conversationId === undefined && configuredModel === undefined) {
              appendWarning(noModelSelectionMessage());
            } else {
              const turnGeneration = conversationTurnBoundary.capture();
              conversationTurnGeneration = turnGeneration;
              if (session.conversationId === undefined) {
                const conversationGoalId = selectedConversationGoalId(state.goal, session.goalId);
                const created = await client.createConversation(
                  buildConversationInput(project.projectId, conversationGoalId, configuredModel!),
                  { idempotencyKey: randomUUID() },
                );
                if (!conversationTurnBoundary.isCurrent(turnGeneration)) {
                  editor.addToHistory(text);
                  return;
                }
                session = {
                  workspacePath: sessionWorkspacePath,
                  projectId: project.projectId,
                  ...(conversationGoalId === undefined ? {} : { goalId: conversationGoalId }),
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
              if (!conversationTurnBoundary.isCurrent(turnGeneration)) {
                editor.addToHistory(text);
                return;
              }
              conversation = addConversationMessage(conversation, "user", text);
              render();
              const streamController = new AbortController();
              conversationStreamController?.abort();
              conversationStreamController = streamController;
              const displayGeneration = conversationDisplayBoundary.capture();
              void streamConversation(activeConversationId, project.projectId, streamController, displayGeneration);
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
                const terminalType =
                  result.turn.status === "completed"
                    ? "turn_completed"
                    : result.turn.status === "cancelled"
                      ? "turn_cancelled"
                      : result.turn.status === "failed"
                        ? "turn_failed"
                        : "turn_unknown";
                const terminalEvent: ConversationEvent = {
                  cursor: result.turn.cursor,
                  eventId: result.turn.turnId,
                  conversationId: result.turn.conversationId,
                  projectId: project.projectId,
                  eventType: terminalType,
                  payload: {
                    turnId: result.turn.turnId,
                    status: result.conversation.status,
                    ...(result.turn.status === "completed" ? { content: result.turn.content } : { message: result.turn.content }),
                  },
                  occurredAt: result.turn.createdAt,
                };
                if (conversationTurnBoundary.isCurrent(turnGeneration) && conversationDisplayBoundary.isCurrent(displayGeneration)) {
                  conversation = applyConversationEvent(conversation, terminalEvent);
                  if (terminal.rows < 16) {
                    compactConversationResult = compactConversationAcknowledgement(conversation, terminal.columns);
                    compactCommandResult = undefined;
                    compactTaskContractReview = false;
                  }
                  showDraftIfPresent(result.turn.content);
                  render();
                }
              } finally {
                if (isCurrentConversationTurnController(turnController, conversationTurnController)) {
                  conversationTurnController = undefined;
                  state.working = false;
                  render();
                }
              }
            }
          }
        }
      } catch (error) {
        if (conversationTurnGeneration === undefined || conversationTurnBoundary.isCurrent(conversationTurnGeneration))
          appendError(`Input error: ${error instanceof Error ? error.message : "invalid input"}`);
      } finally {
        if (ownsNaturalSubmit) naturalSubmitInFlight = false;
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
    tui.setLayoutRoot(
      new VStack([
        { component: statusRegion, basis: "auto", shrink: 0, minSize: 1 },
        { component: transcriptView, basis: 0, grow: 1, minSize: 0, visible: () => terminal.rows >= 16 },
        { component: decisionRegion, basis: "auto", shrink: 0, minSize: 0, visible: () => (state.pendingDecisions?.length ?? 0) > 0 },
        {
          component: noticeRegion,
          basis: "auto",
          shrink: 0,
          minSize: 0,
          visible: () => terminal.rows >= 16 || accountLoginSelection !== undefined,
        },
        { component: dock, basis: "auto", shrink: 1, minSize: 1 },
      ]),
    );
    tui.setFocus(editor);
    render();

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      invalidateDashboardRefreshes();
      conversationTurnBoundary.invalidate();
      conversationDisplayBoundary.clear();
      naturalSubmitInFlight = false;
      providerLoginGeneration += 1;
      providerLoginInFlight = false;
      providerLoginInFlightProvider = undefined;
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
    const cancelActiveConversation = (): boolean =>
      cancelConversationTurn({
        controller: conversationTurnController,
        client,
        projectId: project.kind === "attached" ? project.projectId : undefined,
        conversationId: session?.conversationId,
        onWarning: appendWarning,
        onError: appendError,
      });

    tui.addInputListener((data) => {
      if (
        shouldConsumePendingProviderLoginBackgroundInput(pendingProviderLogin, data) ||
        shouldConsumeProviderLoginInFlightBackgroundInput(providerLoginInFlight, data)
      )
        return { consume: true };
      const reviewShortcut = matchesKey(data, "ctrl+a");
      const reviewAvailable = pendingConfirmation !== undefined || (state.pendingDecisions?.length ?? 0) > 0;
      if (compactHelp !== undefined) {
        compactHelp = undefined;
        render();
      }
      if (compactModelList !== undefined) {
        compactModelList = undefined;
        render();
      }
      if (compactTaskContractReview) {
        compactTaskContractReview = false;
        render();
      }
      if (compactConversationResult !== undefined) {
        compactConversationResult = undefined;
        render();
      }
      if (compactCommandResult !== undefined) {
        compactCommandResult = undefined;
        render();
      }
      if (compactReview !== undefined && (!reviewShortcut || !reviewAvailable)) {
        compactReview = undefined;
        render();
      }
      if (
        shouldConsumeAccountLoginBackgroundInput(
          accountLoginState,
          matchesKey(data, "ctrl+c"),
          matchesKey(data, "escape"),
          matchesKey(data, "alt+c"),
        )
      ) {
        return { consume: true };
      }
      if (shouldConsumeAccountLoginSelectingBackgroundInput(accountLoginState, data)) return { consume: true };
      if (isSplashRestoreShortcut(data)) {
        splash.restore();
        tui.requestRender(true);
        return { consume: true };
      }
      if (dispatchCommandPaletteInput(data, append)) return { consume: true };
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
      if (matchesKey(data, "escape") && shouldCancelPendingProviderLogin(pendingProviderLogin)) {
        pendingProviderLogin = undefined;
        editor.hidden = false;
        editor.setText("");
        appendWarning("Provider login cancelled.");
        render();
        return { consume: true };
      }
      if (accountLoginSelection !== undefined && accountLoginState === "opening" && matchesKey(data, "escape")) {
        cancelAccountLogin();
        appendWarning("Account login cancelled.");
        return { consume: true };
      }
      if (accountLoginSelection !== undefined && accountLoginState === "selecting") {
        if (matchesKey(data, "up") || matchesKey(data, "down")) {
          accountLoginSelection = accountLoginSelection === 0 ? 1 : 0;
          render();
          return { consume: true };
        }
        if (matchesKey(data, "escape")) {
          cancelAccountLogin();
          return { consume: true };
        }
        if (matchesKey(data, "enter")) {
          void startAccountLogin();
          return { consume: true };
        }
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
      if (
        pendingConfirmation !== undefined &&
        (matchesKey(data, "up") || matchesKey(data, "down")) &&
        pendingConfirmation.summary.repetitionScope !== undefined
      ) {
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
        compactReview = terminal.rows < 16 ? compactReviewAcknowledgement(pendingConfirmation.summary, [], terminal.columns) : undefined;
        append(renderApprovalDialog(pendingConfirmation.summary, terminal.columns).join("\n"));
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+a") && pendingConfirmation === undefined && (state.pendingDecisions?.length ?? 0) > 0) {
        compactReview =
          terminal.rows < 16 ? compactReviewAcknowledgement(undefined, state.pendingDecisions ?? [], terminal.columns) : undefined;
        append(renderPendingDecisionDetails(state, terminal.columns).join("\n"));
        return { consume: true };
      }
      if (pendingConfirmation !== undefined && data === "?") {
        const { summary } = pendingConfirmation;
        appendWarning(
          `Approval tier: ${summary.tier === "user" ? "You" : (summary.tier ?? "You")}; scope: ${summary.repetitionScope ?? "once"}. Reject proposes: ${summary.saferAlternative ?? "a safer alternative"}`,
        );
        return { consume: true };
      }
      if (
        pendingConfirmation !== undefined &&
        (data === "y" || data === "Y" || data === "n" || data === "N" || data === "\r" || data === "\u001b")
      ) {
        const decision: ConfirmationResult =
          data === "y" || data === "Y"
            ? pendingConfirmation.summary.repetitionScope === undefined
              ? "approved"
              : { decision: "approved", repetitionScope: pendingConfirmation.summary.repetitionScope }
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
    const runtime = createTuiRuntime({ start: startTui, stop });
    runtime.start();
    if (projectDiscoveryNotice !== undefined) appendWarning(projectDiscoveryNotice);
    void refreshDashboard();
    void offerAutomaticProviderSignIn();
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
