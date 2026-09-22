import { matchesKey } from "@earendil-works/pi-tui";
import { copyToClipboard } from "../../external-url.js";
import { dispatchCommandPaletteInput } from "../commands/palette.js";
import { applyApprovalAction } from "../components/approval-dialog-click.js";
import { applyProviderLoginAction } from "../components/provider-login-click.js";
import { isSidebarVisible, SIDEBAR_MIN_COLUMNS, toggleSidebar } from "../components/sidebar.js";
import { activateSidebarRow, isSidebarNavActive, moveSidebarFocus, NAV_ROWS, sidebarFocusRows } from "../components/sidebar-nav.js";
import { activateSidebarChannel, channelRowKey } from "../components/sidebar-channels.js";
import { cancelConversationTurn } from "../conversation-cancellation.js";
import {
  isSplashRestoreShortcut,
  shouldCancelPendingProviderLogin,
  shouldConsumeAccountLoginBackgroundInput,
  shouldConsumeAccountLoginSelectingBackgroundInput,
  shouldConsumePendingProviderLoginBackgroundInput,
  shouldConsumeProviderLoginInFlightBackgroundInput,
  compactReviewAcknowledgement,
} from "../entry-helpers.js";
import { renderPendingDecisionDetails } from "../components/shell.js";
import type { TuiController } from "./controller.js";

export class LifecycleHandler {
  constructor(private c: TuiController) {}

  stop = (): void => {
    const c = this.c;
    if (c.stopped) return;
    c.stopped = true;
    c.invalidateDashboardRefreshes();
    c.conversationTurnBoundary.invalidate();
    c.conversationDisplayBoundary.clear();
    c.naturalSubmitInFlight = false;
    c.providerLoginGeneration += 1;
    c.providerLoginInFlight = false;
    c.providerLoginInFlightProvider = undefined;
    c.pendingConfirmation?.resolve("cancelled");
    c.pendingConfirmation = undefined;
    c.view.syncPendingDecisionState();
    c.activityController?.abort();
    c.conversationTurnController?.abort();
    c.conversationStreamController?.abort();
    c.conversationActivityController?.abort();
    if (c.workingLoaderTimer !== undefined) clearInterval(c.workingLoaderTimer);
    c.accountLoginController?.abort();
    if (c.accountLoginId !== undefined && c.client !== undefined) void c.client.cancelAccountLogin("openai-codex", c.accountLoginId).catch(() => undefined);
    c.flashmobAnimationId += 1;
    c.tui.stop();
    c.finish(0);
  };

  cancelActiveConversation = (): boolean => {
    const c = this.c;
    const cancelled = cancelConversationTurn({
      controller: c.conversationTurnController,
      client: c.client,
      projectId: c.project.kind === "attached" ? c.project.projectId : undefined,
      conversationId: c.session?.conversationId,
      onWarning: c.view.appendWarning,
      onError: c.view.appendError,
    });
    if (!cancelled) return false;
    c.conversationTurnBoundary.invalidate();
    c.conversationTurnController = undefined;
    c.conversationActivityController?.abort();
    c.conversationActivityController = undefined;
    if (c.workingLoaderTimer !== undefined) {
      clearInterval(c.workingLoaderTimer);
      c.workingLoaderTimer = undefined;
    }
    c.state.working = false;
    delete c.state.workingSince;
    delete c.state.workingTick;
    delete c.state.conversationActivity;
    c.view.render();
    return true;
  };

  handleInput = (data: string): { consume: boolean } | undefined => {
    const c = this.c;
    if (
      shouldConsumePendingProviderLoginBackgroundInput(c.pendingProviderLogin, data) ||
      shouldConsumeProviderLoginInFlightBackgroundInput(c.providerLoginInFlight, data)
    )
      return { consume: true };
    const reviewShortcut = matchesKey(data, "ctrl+a");
    const reviewAvailable = c.pendingConfirmation !== undefined || (c.state.pendingDecisions?.length ?? 0) > 0;
    if (c.compactHelp !== undefined) {
      c.compactHelp = undefined;
      c.view.render();
    }
    if (c.compactModelList !== undefined) {
      c.compactModelList = undefined;
      c.view.render();
    }
    if (c.compactTaskContractReview) {
      c.compactTaskContractReview = false;
      c.view.render();
    }
    if (c.compactConversationResult !== undefined) {
      c.compactConversationResult = undefined;
      c.view.render();
    }
    if (c.compactCommandResult !== undefined) {
      c.compactCommandResult = undefined;
      c.view.render();
    }
    if (c.compactReview !== undefined && (!reviewShortcut || !reviewAvailable)) {
      c.compactReview = undefined;
      c.view.render();
    }
    if (
      shouldConsumeAccountLoginBackgroundInput(
        c.accountLoginState,
        matchesKey(data, "ctrl+c"),
        matchesKey(data, "escape"),
        matchesKey(data, "alt+c"),
      )
    ) {
      return { consume: true };
    }
    if (shouldConsumeAccountLoginSelectingBackgroundInput(c.accountLoginState, data)) return { consume: true };
    if (isSplashRestoreShortcut(data)) {
      c.splash.restore();
      c.tui.requestRender(true);
      return { consume: true };
    }
    if (dispatchCommandPaletteInput(data, c.view.append)) return { consume: true };
    if (matchesKey(data, "ctrl+b")) {
      if (c.terminal.columns < SIDEBAR_MIN_COLUMNS) {
        c.narrowSidebarNavActive = !c.narrowSidebarNavActive;
        if (c.narrowSidebarNavActive) {
          const selected = NAV_ROWS.some((row) => row.id === c.sidebarSelection) ? c.sidebarSelection : "home";
          c.sidebarFocus = NAV_ROWS.some((row) => row.id === c.sidebarFocus) ? c.sidebarFocus : selected;
        } else {
          c.sidebarFocus = undefined;
        }
        c.view.render();
        return { consume: true };
      }
      c.narrowSidebarNavActive = false;
      toggleSidebar(c, NAV_ROWS);
      return { consume: true };
    }
    // A focused but narrowed sidebar keeps its focus value for widening, but
    // only the explicit narrow nav mode may use it while the pane is hidden.
    const sidebarKeyboardActive =
      isSidebarNavActive(c) && (isSidebarVisible(c.sidebarVisible, c.terminal.columns) || c.narrowSidebarNavActive);
    if (sidebarKeyboardActive) {
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        c.sidebarFocus = moveSidebarFocus(
          c.sidebarFocus,
          matchesKey(data, "up") ? -1 : 1,
          c.narrowSidebarNavActive ? NAV_ROWS : sidebarFocusRows(c.sidebarGoals, c.sidebarChannels.map((read) => channelRowKey(read))),
        );
        c.view.render();
        return { consume: true };
      }
      if (matchesKey(data, "enter")) {
        if (c.sidebarFocus !== undefined) {
          activateSidebarRow(c, c.sidebarFocus);
          activateSidebarChannel(c, c.sidebarFocus);
          if (c.narrowSidebarNavActive) {
            c.narrowSidebarNavActive = false;
            c.sidebarFocus = undefined;
            c.view.render();
          }
        }
        return { consume: true };
      }
      if (matchesKey(data, "escape")) {
        c.narrowSidebarNavActive = false;
        c.sidebarFocus = undefined;
        c.view.render();
        return { consume: true };
      }
      // Control keys keep their existing global behavior (cancel, shortcuts):
      // execution falls out of this block to the branches below. Only
      // printable input is swallowed so typing never reaches the editor while
      // sidebar focus is shown. Compares bytes, never key names, so no
      // control-byte literal is needed here.
      if (data.charCodeAt(0) !== 27 && !(data.length === 1 && data < " ")) return { consume: true };
    }
    if (matchesKey(data, "ctrl+g")) {
      void c.submitter.submit("/goals list");
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+e")) {
      void c.submitter.submit("/events list");
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+r")) {
      void c.submitter.submit("/session retry");
      return { consume: true };
    }
    if (matchesKey(data, "escape") && this.cancelActiveConversation()) return { consume: true };
    if (matchesKey(data, "ctrl+c")) {
      if (this.cancelActiveConversation()) return { consume: true };
      this.stop();
      return { consume: true };
    }
    if (matchesKey(data, "escape") && shouldCancelPendingProviderLogin(c.pendingProviderLogin)) {
      c.pendingProviderLogin = undefined;
      c.editor.hidden = false;
      c.editor.setText("");
      c.view.appendWarning("Provider login cancelled.");
      c.view.render();
      return { consume: true };
    }
    if (c.accountLoginSelection !== undefined && c.accountLoginState === "opening" && matchesKey(data, "escape")) {
      c.auth.cancelAccountLogin();
      c.view.appendWarning("Account login cancelled.");
      return { consume: true };
    }
    if (c.accountLoginSelection !== undefined && c.accountLoginState === "selecting") {
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        if (applyProviderLoginAction(c, { kind: "select", selection: c.accountLoginSelection === 0 ? 1 : 0 })) {
          return { consume: true };
        }
      }
      if (matchesKey(data, "escape")) {
        if (applyProviderLoginAction(c, { kind: "cancel" })) return { consume: true };
      }
      if (matchesKey(data, "enter")) {
        if (applyProviderLoginAction(c, { kind: "continue" })) return { consume: true };
      }
      return { consume: true };
    }
    if (c.accountLoginSelection !== undefined && c.accountLoginState === "waiting" && matchesKey(data, "alt+c")) {
      const url = c.accountLoginUrl;
      if (url === undefined) c.view.appendWarning("The provider login link is not ready yet.");
      else {
        void (c.options.io.copyToClipboard ?? copyToClipboard)(url)
          .then(() => c.view.appendSuccess("Provider login link copied to the clipboard."))
          .catch(() => c.view.appendWarning(`Clipboard unavailable. Copy this provider login link: ${url}`));
      }
      return { consume: true };
    }
    if (c.accountLoginSelection !== undefined && c.accountLoginState === "waiting" && matchesKey(data, "escape")) {
      c.auth.cancelAccountLogin();
      c.view.appendWarning("Account login cancelled.");
      return { consume: true };
    }
    if (
      c.pendingConfirmation !== undefined &&
      (matchesKey(data, "up") || matchesKey(data, "down")) &&
      c.pendingConfirmation.summary.repetitionScope !== undefined
    ) {
      if (applyApprovalAction(c, { kind: "cycle-scope", direction: matchesKey(data, "up") ? -1 : 1 })) return { consume: true };
    }
    if (matchesKey(data, "ctrl+a") && c.pendingConfirmation !== undefined) {
      if (applyApprovalAction(c, { kind: "reveal" })) return { consume: true };
    }
    if (matchesKey(data, "ctrl+a") && c.pendingConfirmation === undefined && (c.state.pendingDecisions?.length ?? 0) > 0) {
      c.compactReview =
        c.terminal.rows < 16 ? compactReviewAcknowledgement(undefined, c.state.pendingDecisions ?? [], c.contentWidth()) : undefined;
      c.view.append(renderPendingDecisionDetails(c.state, c.contentWidth()).join("\n"));
      return { consume: true };
    }
    if (c.pendingConfirmation !== undefined && data === "?") {
      if (applyApprovalAction(c, { kind: "why" })) return { consume: true };
    }
    if (
      c.pendingConfirmation !== undefined &&
      (data === "y" || data === "Y" || data === "n" || data === "N" || data === "\r" || data === "\u001b")
    ) {
      if (applyApprovalAction(c, { kind: "resolve", decision: data === "y" || data === "Y" ? "approved" : "cancelled" })) {
        return { consume: true };
      }
    }
    return undefined;
  };
}
