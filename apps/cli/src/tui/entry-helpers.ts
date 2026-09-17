import { matchesKey } from "@earendil-works/pi-tui";
import type { ApiClient } from "@maestro/api-client";
import type { ModelCatalogEntry } from "@maestro/contracts";
import { setupRequiredGuidance, type PendingDecision, type TuiShellState } from "./components/shell.js";
import type { ApprovalDialogSummary } from "./confirmation.js";
import { COMPACT_PROVIDER_LOGIN_MIN_HEIGHT, type AccountLoginProviderSelection } from "./components/provider-login-dialog.js";
import { fitPlain } from "./theme.js";
import { selectWorkspaceModel, type WorkspaceSession } from "./session.js";
import type { ConversationTranscriptState } from "./conversation-transcript.js";

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
  if (projectDiscoveryNotice === "No projects are available for this operator")
    return fitPlain("No project · admin provision · ctrl+r", width);
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
  return ["Task contract ready · resize to review", "/task-contract confirm", "/task-contract launch"]
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

export function isCurrentConversationTurnController(controller: AbortController, activeController: AbortController | undefined): boolean {
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
  if (identities.length === 0)
    return fitPlain(
      unavailableLabel === undefined ? "No models available · retry /models list" : "Catalog unavailable · retry /models",
      width,
    );
  const identity = identities[0]!;
  const commandPrefix = "/model use --model";
  const command = `${commandPrefix} ${identity}`;
  if (width <= 0) return "";
  if (command.length <= width) return command;
  const wrap = (text: string): string[] => {
    const lines: string[] = [];
    for (let offset = 0; offset < text.length; offset += width) lines.push(text.slice(offset, offset + width));
    return lines;
  };
  return [...wrap(commandPrefix), ...wrap(identity)].join("\n");
}

export function compactConversationAcknowledgement(
  conversation: Pick<ConversationTranscriptState, "assistantText" | "status" | "statusMessage">,
  width: number,
): string {
  const content = (
    conversation.assistantText ||
    conversation.statusMessage ||
    (conversation.status === "streaming" ? "Waiting for response…" : conversation.status)
  )
    .replace(/\s+/g, " ")
    .trim();
  const label = conversation.status === "streaming" ? "Maestro · streaming" : `Maestro · ${conversation.status}`;
  return fitPlain(`${label}: ${content}`, width);
}

export function shouldIgnoreEmptySubmit(text: string, pendingProviderLogin: string | undefined): boolean {
  return pendingProviderLogin === undefined && text.trim() === "";
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
