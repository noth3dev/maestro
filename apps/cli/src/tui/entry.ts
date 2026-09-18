import { ProcessTerminal, TuiAltScreen, VStack } from "@earendil-works/pi-tui";

import { createTranscriptClearBoundary, executeBasicShellCommand, latestCopyableTranscriptText } from "./basic-shell.js";
import { taskContractDraftForConversation } from "./conversation-draft.js";

import { createStatusRegion } from "./components/regions.js";
import { createSplashController, type TuiShellState } from "./components/shell.js";

import { TuiController } from "./loop/controller.js";

export { type InteractiveTuiOptions } from "./startup.js";
import { initializeTui, type InteractiveTuiOptions } from "./startup.js";
import {
  approvalPendingAcknowledgement,
  compactCommandResultAcknowledgement,
  compactConnectionRecoveryAcknowledgement,
  compactConversationAcknowledgement,
  compactHelpAcknowledgement,
  compactModelListAcknowledgement,
  compactProjectAttachmentNotice,
  compactProviderLoginAcknowledgement,
  compactReviewAcknowledgement,
  compactTaskContractAcknowledgement,
  createAutomaticProviderSignInGate,
  firstAvailableModelIdentity,
  isCurrentAccountLoginOperation,
  isCurrentConversationTurnController,
  isCurrentProviderLoginOperation,
  isProviderLoginActive,
  isSplashRestoreShortcut,
  isStartupCancellationInput,
  noModelSelectionMessage,
  persistProviderLoginModelSelection,
  runAutomaticProviderSignInOffer,
  isAutomaticProviderSignInProjectEligible,
  shouldBlockConcurrentTurnSubmit,
  shouldBlockPendingConfirmationSubmit,
  shouldBlockProviderLoginInFlightSubmit,
  shouldCancelPendingProviderLogin,
  shouldConsumeAccountLoginBackgroundInput,
  shouldConsumeAccountLoginSelectingBackgroundInput,
  shouldConsumePendingProviderLoginBackgroundInput,
  shouldConsumeProviderLoginInFlightBackgroundInput,
  shouldDeferAutomaticProviderSignIn,
  shouldHandoffAfterProviderLogin,
  shouldIgnoreEmptySubmit,
  shouldRetryAutomaticProviderSignIn,
} from "./entry-helpers.js";
export * from "./entry-helpers.js";
export {
  approvalPendingAcknowledgement,
  compactCommandResultAcknowledgement,
  compactConnectionRecoveryAcknowledgement,
  compactConversationAcknowledgement,
  compactHelpAcknowledgement,
  compactModelListAcknowledgement,
  compactProjectAttachmentNotice,
  compactProviderLoginAcknowledgement,
  compactReviewAcknowledgement,
  compactTaskContractAcknowledgement,
  createAutomaticProviderSignInGate,
  firstAvailableModelIdentity,
  isCurrentAccountLoginOperation,
  isCurrentConversationTurnController,
  isCurrentProviderLoginOperation,
  isProviderLoginActive,
  isSplashRestoreShortcut,
  isStartupCancellationInput,
  noModelSelectionMessage,
  persistProviderLoginModelSelection,
  runAutomaticProviderSignInOffer,
  isAutomaticProviderSignInProjectEligible,
  shouldBlockConcurrentTurnSubmit,
  shouldBlockPendingConfirmationSubmit,
  shouldBlockProviderLoginInFlightSubmit,
  shouldCancelPendingProviderLogin,
  shouldConsumeAccountLoginBackgroundInput,
  shouldConsumeAccountLoginSelectingBackgroundInput,
  shouldConsumePendingProviderLoginBackgroundInput,
  shouldConsumeProviderLoginInFlightBackgroundInput,
  shouldDeferAutomaticProviderSignIn,
  shouldHandoffAfterProviderLogin,
  shouldIgnoreEmptySubmit,
  shouldRetryAutomaticProviderSignIn,
};
export { createTranscriptClearBoundary, executeBasicShellCommand, latestCopyableTranscriptText };
export type { BasicShellCommandContext, BasicShellCommandName } from "./basic-shell.js";

export { taskContractDraftForConversation };
export {
  applyHydratedConversation,
  handleConversationStreamEvent,
  hydrateOrganizationOnReconnect,
  resolveConfiguredModel,
} from "./entry-hydration.js";
import type { LocalBootstrapStepEvent } from "./local-bootstrap.js";

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
  const { workspace, startupError, connection, session, project, projectDiscoveryNotice, client } = initialized;
  return new TuiController({
    terminal,
    tui,
    state: liveState,
    splash,
    options,
    updateSetupStep,
    startTui,
    statusRegion,
    workspace,
    startupError,
    connection,
    session,
    project,
    projectDiscoveryNotice,
    client,
  }).run();
}
