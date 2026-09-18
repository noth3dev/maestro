import { ApiError } from "@maestro/api-client";
import { openExternalUrl } from "../../external-url.js";
import { waitForAccountLogin } from "../account-login.js";
import {
  firstAvailableModelIdentity,
  isAutomaticProviderSignInProjectEligible,
  isCurrentAccountLoginOperation,
  isCurrentProviderLoginOperation,
  isProviderLoginActive,
  persistProviderLoginModelSelection,
  runAutomaticProviderSignInOffer,
  shouldDeferAutomaticProviderSignIn,
  shouldHandoffAfterProviderLogin,
} from "../entry-helpers.js";
import { resolveConfiguredModel } from "../entry-hydration.js";
import { COMPACT_PROVIDER_LOGIN_MIN_HEIGHT } from "../components/provider-login-dialog.js";
import { saveWorkspaceSession } from "../session.js";
import type { TuiController } from "./controller.js";

export class AuthFlows {
  constructor(private c: TuiController) {}

  handoffToAvailableModel = async (loginLabel: string, isCurrent: () => boolean = () => true): Promise<void> => {
    const c = this.c;
    if (
      c.client === undefined ||
      !shouldHandoffAfterProviderLogin(resolveConfiguredModel(c.options.env.MAESTRO_MODEL, c.session?.model), c.session?.conversationId)
    )
      return;
    try {
      const models = await c.client.listModels();
      if (!isCurrent()) return;
      const selectedModel = firstAvailableModelIdentity(models);
      if (selectedModel === undefined) {
        c.view.appendWarning(
          `${loginLabel} complete, but no model is available. Run /models list, then /model use --model provider/model.`,
        );
      } else {
        const persisted = await persistProviderLoginModelSelection({
          workspacePath: c.sessionWorkspacePath,
          session: c.session,
          model: selectedModel,
          isCurrent,
          save: saveWorkspaceSession,
          setSession: (nextSession) => {
            c.session = nextSession;
          },
          setModel: (model) => {
            c.state.model = model;
          },
        });
        if (!persisted) return;
        c.view.appendSuccess(`Model selected after ${loginLabel}: ${selectedModel}`);
      }
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "request failed";
      c.view.appendWarning(
        `${loginLabel} complete, but model discovery failed: ${message}. Run /models list, then /model use --model provider/model.`,
      );
    }
  };

  cancelAccountLogin = (): void => {
    const c = this.c;
    const controller = c.accountLoginController;
    const loginId = c.accountLoginId;
    c.accountLoginController = undefined;
    c.accountLoginId = undefined;
    c.accountLoginUrl = undefined;
    c.accountLoginSelection = undefined;
    c.accountLoginState = undefined;
    c.editor.hidden = false;
    c.editor.setText("");
    controller?.abort();
    if (loginId !== undefined && c.client !== undefined) void c.client.cancelAccountLogin(loginId).catch(() => undefined);
    c.view.render();
  };

  startAccountLogin = async (): Promise<void> => {
    const c = this.c;
    if (c.client === undefined) {
      c.view.appendWarning("Account login is unavailable until the Control Plane is connected.");
      this.cancelAccountLogin();
      return;
    }
    if (c.accountLoginSelection === 1) {
      c.view.appendWarning("Claude Pro / Max account login is unavailable until Anthropic approves a public OAuth integration.");
      this.cancelAccountLogin();
      return;
    }
    c.accountLoginState = "opening";
    c.view.render();
    const controller = new AbortController();
    c.accountLoginController = controller;
    try {
      const login = await c.client.startAccountLogin();
      if (!isCurrentAccountLoginOperation(controller, c.accountLoginController)) return;
      c.accountLoginId = login.loginId;
      c.accountLoginUrl = login.authUrl;
      c.accountLoginState = "waiting";
      c.view.render();
      const status = await waitForAccountLogin({
        client: c.client,
        loginId: login.loginId,
        authUrl: login.authUrl,
        signal: controller.signal,
        openExternalUrl: c.options.io.openExternalUrl ?? openExternalUrl,
        onOpenFailure: (url) => c.view.append(`Open this URL in your browser to sign in: ${url}`),
        timeoutMs: Number(c.options.env.MAESTRO_LOGIN_TIMEOUT_MS ?? "120000"),
        pollMs: Number(c.options.env.MAESTRO_LOGIN_POLL_MS ?? "500"),
      });
      if (!isCurrentAccountLoginOperation(controller, c.accountLoginController) || status === undefined) return;
      if (status.state === "succeeded") {
        c.view.appendSuccess("Account login complete: openai-codex");
        await this.handoffToAvailableModel("Account login");
        void c.refreshDashboard();
      } else if (status.state === "failed")
        c.view.appendError(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
      else c.view.appendWarning(`Account login ${status.state}: ${status.message ?? "no additional details"}`);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "request failed";
        const detail = error instanceof ApiError && error.detail !== undefined ? ` (${error.detail})` : "";
        c.view.appendError(`Account login failed: ${message}${detail}`);
      }
    } finally {
      if (c.accountLoginController === controller) {
        c.accountLoginController = undefined;
        c.accountLoginId = undefined;
        c.accountLoginUrl = undefined;
        c.accountLoginSelection = undefined;
        c.accountLoginState = undefined;
        c.editor.hidden = false;
        c.view.render();
      }
    }
  };

  offerAutomaticProviderSignIn = (): void => {
    const c = this.c;
    if (c.client === undefined) return;
    const candidateClient = c.client;
    const candidateGeneration = c.connectionGeneration;
    const candidateLoginInteractionGeneration = c.loginInteractionGeneration;
    void runAutomaticProviderSignInOffer({
      client: candidateClient,
      getConfiguredModel: () => resolveConfiguredModel(c.options.env.MAESTRO_MODEL, c.session?.model),
      gate: c.automaticProviderSignInGate,
      isCurrent: () =>
        !c.stopped &&
        c.client === candidateClient &&
        c.connectionGeneration === candidateGeneration &&
        c.loginInteractionGeneration === candidateLoginInteractionGeneration &&
        c.state.connection.kind === "connected" &&
        isAutomaticProviderSignInProjectEligible(c.project.kind),
      isManualLoginActive: () => isProviderLoginActive(c.pendingProviderLogin, c.providerLoginInFlight, c.accountLoginSelection),
      canOffer: () => c.terminal.rows >= COMPACT_PROVIDER_LOGIN_MIN_HEIGHT && !shouldDeferAutomaticProviderSignIn(c.editor.getText()),
      onOffer: () => {
        if (c.terminal.rows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT || shouldDeferAutomaticProviderSignIn(c.editor.getText())) return;
        c.accountLoginSelection = 0;
        c.accountLoginState = "selecting";
        c.editor.hidden = true;
        c.editor.setText("");
        c.view.render();
      },
    });
  };

  submitProviderLogin = async (text: string): Promise<void> => {
    const c = this.c;
    const providerId = c.pendingProviderLogin!;
    const operationGeneration = ++c.providerLoginGeneration;
    c.pendingProviderLogin = undefined;
    c.providerLoginInFlight = true;
    c.providerLoginInFlightProvider = providerId;
    c.editor.hidden = false;
    c.editor.setText("");
    c.view.render();
    const isCurrentProviderLogin = (): boolean =>
      isCurrentProviderLoginOperation(operationGeneration, c.providerLoginGeneration, c.stopped);
    try {
      if (c.client === undefined) {
        c.view.appendWarning("Provider login is unavailable until the Control Plane is connected.");
      } else {
        await c.client.loginProvider({ providerId, authMode: "api-key", secret: text });
        if (!isCurrentProviderLogin()) return;
        c.view.appendSuccess(`Provider login complete: ${providerId} API key stored by the model gateway.`);
        await this.handoffToAvailableModel("Provider login", isCurrentProviderLogin);
      }
    } catch (error) {
      if (isCurrentProviderLogin())
        c.view.appendError(`Provider login failed: ${error instanceof Error ? error.message : "request failed"}`);
    } finally {
      if (isCurrentProviderLogin()) {
        c.providerLoginInFlight = false;
        c.providerLoginInFlightProvider = undefined;
        c.view.render();
      }
    }
  };
}
