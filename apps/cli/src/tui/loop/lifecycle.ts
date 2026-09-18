import { matchesKey } from "@earendil-works/pi-tui";
import { copyToClipboard } from "../../external-url.js";
import { dispatchCommandPaletteInput } from "../commands/palette.js";
import { applyApprovalAction } from "../components/approval-dialog-click.js";
import { applyProviderLoginAction } from "../components/provider-login-click.js";
import { toggleSidebar } from "../components/sidebar.js";
import { applySidebarNavAction, isSidebarNavActive, moveSidebarFocus, NAV_ROWS } from "../components/sidebar-nav.js";
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
    if (c.accountLoginId !== undefined && c.client !== undefined) void c.client.cancelAccountLogin(c.accountLoginId).catch(() => undefined);
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
      toggleSidebar(c, NAV_ROWS);
      return { consume: true };
    }
    if (isSidebarNavActive(c)) {
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        c.sidebarFocus = moveSidebarFocus(c.sidebarFocus, matchesKey(data, "up") ? -1 : 1, NAV_ROWS);
        c.view.render();
        return { consume: true };
      }
      if (matchesKey(data, "enter")) {
        if (c.sidebarFocus !== undefined) applySidebarNavAction(c, c.sidebarFocus);
        return { consume: true };
      }
      if (matchesKey(data, "escape")) {
        c.sidebarFocus = undefined;
        c.view.render();
        return { consume: true };
      }
      return { consume: true };
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
