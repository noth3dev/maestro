import { fitPlain, tuiTheme } from "../theme.js";
import {
  compactCommandResultAcknowledgement,
  compactConnectionRecoveryAcknowledgement,
  compactModelListAcknowledgement,
  compactProjectAttachmentNotice,
  compactProviderLoginAcknowledgement,
  compactTaskContractAcknowledgement,
  shouldRetryAutomaticProviderSignIn,
} from "../entry-helpers.js";
import { renderInputPlaceholder, renderTuiFooter } from "../components/shell.js";
import { createDynamicRegion } from "../components/regions.js";
import { draftForPresentation } from "../draft-presentation.js";
import { renderTaskContractDraft } from "../goal-less-intake.js";
import { resolveConfiguredModel } from "../entry-hydration.js";
import { animateAccentProgress } from "../flashmob-animation.js";
import { getModeAccentProgress, setModeAccentProgress } from "../theme.js";
import { selectedConversationGoalId } from "../dashboard-state.js";
import { pendingDecisionsForView } from "../pending-decisions.js";
import { addConversationMessage } from "../conversation-transcript.js";
import type { TranscriptLine } from "../theme.js";
import type { TuiController } from "./controller.js";

export class TuiView {
  constructor(private c: TuiController) {}

  syncPendingDecisionState = (): void => {
    const c = this.c;
    const goalId = selectedConversationGoalId(c.state.goal, c.session?.goalId);
    c.state.pendingDecisions = pendingDecisionsForView({
      goalId,
      activity: c.activity,
      ...(c.pendingConfirmation === undefined ? {} : { pendingConfirmation: c.pendingConfirmation }),
    });
  };

  syncModelState = (): void => {
    const c = this.c;
    const model = resolveConfiguredModel(c.options.env.MAESTRO_MODEL, c.session?.model);
    if (model === undefined) delete c.state.model;
    else c.state.model = model;
  };

  syncProjectPresentation = (): void => {
    const c = this.c;
    c.state.project =
      c.project.kind === "attached"
        ? { kind: "attached" }
        : { kind: "unavailable", guidance: c.projectDiscoveryNotice ?? c.project.reason };
  };

  render = (): void => {
    const c = this.c;
    this.syncPendingDecisionState();
    c.footer.setText(c.terminal.rows < 16 ? "" : renderTuiFooter(c.terminal.columns, c.state));
    c.tui.requestRender(true);
  };

  append = (line: string | TranscriptLine): void => {
    const c = this.c;
    c.splash.dismiss();
    const semanticLine: TranscriptLine = typeof line === "string" ? { kind: "system", text: line } : line;
    if (c.terminal.rows < 16) {
      c.compactConversationResult = undefined;
      c.compactTaskContractReview =
        semanticLine.text.includes("/task-contract confirm") && semanticLine.text.includes("/task-contract launch");
      c.compactCommandResult = c.compactTaskContractReview ? undefined : semanticLine.text;
    }
    const next = addConversationMessage(c.conversation, "system", semanticLine.text, semanticLine.kind);
    c.conversation = { ...next, messages: next.messages.slice(-80) };
    this.render();
  };

  appendError = (text: string): void => this.append({ kind: "error", text });
  appendSuccess = (text: string): void => this.append({ kind: "success", text });
  appendWarning = (text: string): void => this.append({ kind: "warning", text });

  buildInputLabel = (): ReturnType<typeof createDynamicRegion> => {
    const c = this.c;
    return createDynamicRegion((width) => {
      const shouldRetryOffer = shouldRetryAutomaticProviderSignIn(c.lastRenderedTerminalRows, c.terminal.rows);
      c.lastRenderedTerminalRows = c.terminal.rows;
      if (shouldRetryOffer) queueMicrotask(() => c.auth.offerAutomaticProviderSignIn());
      return [
        tuiTheme.muted(
          c.compactHelp !== undefined && c.terminal.rows < 16
            ? fitPlain(c.compactHelp, width)
            : c.compactReview !== undefined && c.terminal.rows < 16
              ? fitPlain(c.compactReview, width)
              : c.terminal.rows < 16 && c.state.connection.kind !== "connected"
                ? (compactConnectionRecoveryAcknowledgement(c.state.connection, width) ??
                  renderInputPlaceholder(c.state, width, c.terminal.rows < 16))
                : c.providerLoginInFlightProvider !== undefined && c.terminal.rows < 16
                  ? compactProviderLoginAcknowledgement(c.providerLoginInFlightProvider, width)
                  : c.compactModelList !== undefined && c.terminal.rows < 16
                    ? compactModelListAcknowledgement(c.compactModelList.identities, width, c.compactModelList.unavailableLabel)
                    : c.terminal.rows < 16 && c.project.kind !== "attached"
                      ? compactProjectAttachmentNotice(c.compactProjectNotice, width)
                      : c.compactTaskContractReview && c.terminal.rows < 16
                        ? compactTaskContractAcknowledgement(width)
                        : c.compactConversationResult !== undefined && c.terminal.rows < 16
                          ? c.compactConversationResult
                          : c.compactCommandResult !== undefined && c.terminal.rows < 16
                            ? compactCommandResultAcknowledgement(c.compactCommandResult, width)
                            : renderInputPlaceholder(c.state, width, c.terminal.rows < 16),
        ),
      ];
    });
  };

  showDraftIfPresent = (content: string): void => {
    const c = this.c;
    const presentation = draftForPresentation({
      content,
      goalId: c.session?.goalId,
      current: c.draftedTaskContract,
      renderedIdentity: c.renderedDraftIdentity,
    });
    if (presentation === undefined) return;
    c.draftedTaskContract = presentation.draft;
    if (!presentation.shouldRender) return;
    c.renderedDraftIdentity = presentation.identity;
    this.append({ kind: "system", text: renderTaskContractDraft(presentation.draft).join("\n") });
  };

  animateFlashmobMode = async (enabled: boolean): Promise<void> => {
    const c = this.c;
    const animationId = ++c.flashmobAnimationId;
    const from = getModeAccentProgress();
    const to = enabled ? 1 : 0;
    c.flashmobMode = enabled;
    c.state.mode = enabled ? "flashmob" : "maestro";
    const completed = await animateAccentProgress({
      from,
      to,
      isCurrent: () => animationId === c.flashmobAnimationId,
      setProgress: setModeAccentProgress,
      render: this.render,
      wait: (milliseconds) => new Promise<void>((resolveFrame) => setTimeout(resolveFrame, milliseconds)),
    });
    if (!completed) return;
    this.appendSuccess(`Flashmob ${enabled ? "enabled" : "disabled"} · ${enabled ? "blue" : "Warm Earth"} accent`);
  };
}
