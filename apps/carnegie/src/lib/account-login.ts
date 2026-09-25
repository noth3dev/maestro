import type { ProviderAccountLoginStartResult, ProviderAccountLoginStatus } from "@maestro/contracts";
import { isProviderAuthUrlAllowed, waitForProviderAccountLogin } from "./provider-account-login.js";

export type AccountLoginProviderId = "openai-codex" | "anthropic-claude";

export type AccountLoginPanelState = {
  loginState: "idle" | "opening" | "waiting" | "connected" | "error";
  message?: string | undefined;
  url?: string | undefined;
  linkCopied: boolean;
};

export const initialAccountLoginPanelState: AccountLoginPanelState = { loginState: "idle", linkCopied: false };

type AccountLoginRef = { loginId?: string | undefined; abort?: AbortController | undefined };

type AccountLoginApi = {
  startAccountLogin(providerId: AccountLoginProviderId): Promise<ProviderAccountLoginStartResult>;
  accountLoginStatus(providerId: AccountLoginProviderId, loginId: string): Promise<ProviderAccountLoginStatus>;
  cancelAccountLogin(providerId: AccountLoginProviderId, loginId: string): Promise<void>;
  logoutAccount(providerId: AccountLoginProviderId): Promise<void>;
};

export function createAccountLoginController(deps: {
  providerId: AccountLoginProviderId;
  label: string;
  ref: AccountLoginRef;
  api: AccountLoginApi;
  openExternal: (url: string) => Promise<void>;
  refreshProviderSettings: () => Promise<void>;
  getBusy: () => string | undefined;
  setBusy: (value: string | undefined) => void;
  setPanelState: (patch: Partial<AccountLoginPanelState>) => void;
  setConnected: (connected: boolean) => void;
}) {
  const { providerId, label, ref, api, openExternal, refreshProviderSettings, getBusy, setBusy, setPanelState, setConnected } = deps;

  const start = async () => {
    if (getBusy() !== undefined) return;
    const controller = new AbortController();
    ref.abort = controller;
    ref.loginId = undefined;
    setBusy(providerId);
    setPanelState({ loginState: "opening", message: undefined });
    try {
      const started = await api.startAccountLogin(providerId);
      if (!isProviderAuthUrlAllowed(started.authUrl)) throw new Error("The provider returned an unsafe authentication URL.");
      ref.loginId = started.loginId;
      setPanelState({ url: started.authUrl });
      let browserOpened = true;
      try {
        await openExternal(started.authUrl);
      } catch {
        browserOpened = false;
      }
      setPanelState({ loginState: "waiting" });
      if (!browserOpened) setPanelState({ message: "The browser did not open. Use the sign-in link below." });
      await waitForProviderAccountLogin((loginId) => api.accountLoginStatus(providerId, loginId), started.loginId, {
        signal: controller.signal,
      });
      setConnected(true);
      setPanelState({ loginState: "connected" });
      try {
        await refreshProviderSettings();
        setPanelState({ message: `${label} is ready for Maestro.` });
      } catch {
        setPanelState({ message: `${label} is connected. Settings will refresh on the next load.` });
      }
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const loginId = ref.loginId;
      if (loginId !== undefined) {
        try {
          await api.cancelAccountLogin(providerId, loginId);
        } catch {
          /* preserve the original sign-in error */
        }
      }
      setPanelState({ loginState: "error", message: cause instanceof Error ? cause.message : `Could not complete ${label} login.` });
    } finally {
      if (ref.abort === controller) ref.abort = undefined;
      ref.loginId = undefined;
      setBusy(undefined);
    }
  };

  const cancel = async () => {
    const loginId = ref.loginId;
    ref.abort?.abort();
    if (loginId !== undefined) {
      try {
        await api.cancelAccountLogin(providerId, loginId);
      } catch {
        /* the local cancellation still stops polling */
      }
    }
    ref.loginId = undefined;
    ref.abort = undefined;
    setBusy(undefined);
    setPanelState({ loginState: "idle", message: undefined, url: undefined, linkCopied: false });
  };

  const logout = async () => {
    setBusy(providerId);
    try {
      await api.logoutAccount(providerId);
      setConnected(false);
      setPanelState({ loginState: "idle", message: undefined, url: undefined, linkCopied: false });
      await refreshProviderSettings();
    } catch (cause: unknown) {
      setPanelState({ loginState: "error", message: cause instanceof Error ? cause.message : `Could not disconnect ${label}.` });
    } finally {
      setBusy(undefined);
    }
  };

  const copyLink = async (url: string | undefined) => {
    if (url === undefined) return;
    try {
      await navigator.clipboard.writeText(url);
      setPanelState({ linkCopied: true });
      window.setTimeout(() => setPanelState({ linkCopied: false }), 1800);
    } catch {
      setPanelState({ message: "Copy was blocked. Select the sign-in link manually." });
    }
  };

  return { start, cancel, logout, copyLink };
}
