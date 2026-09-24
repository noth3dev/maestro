import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ProviderAccountLoginStartResult,
  type ProviderAccountLoginStatus,
  type RouterCatalogRead,
  type RouterConfigInput,
} from "@maestro/contracts";
import { Icon } from "../icons.js";
import { useTheme } from "../theme.js";
import { isSessionFailure, useConnection } from "../connection.js";
import { ToggleSwitch } from "../components/ToggleSwitch.js";
import { isProviderAuthUrlAllowed, waitForProviderAccountLogin } from "../lib/provider-account-login.js";
import { createSettingsStore, raisesAuthority, redactSecret, type SettingsApi } from "../lib/settings-data.js";
import { RouterCatalogPanel, nextRouterPool } from "./RouterCatalogPanel.js";

type Panel = "profile" | "appearance" | "connection" | "notifications" | "providers" | "models" | "authority" | "danger";

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

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { config, disconnect, reportSessionFailure } = useConnection();
  const [disconnecting, setDisconnecting] = useState(false);
  const [panel, setPanel] = useState<Panel>("profile");
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof window.maestro.api.getSettings>> | undefined>();
  const settingsStore = useRef<ReturnType<typeof createSettingsStore> | undefined>(undefined);
  if (settingsStore.current === undefined) settingsStore.current = createSettingsStore(window.maestro.api as SettingsApi);
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [pendingAuthority, setPendingAuthority] = useState<Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0] | undefined>();
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [routerCatalog, setRouterCatalog] = useState<RouterCatalogRead | undefined>();
  const [routerCatalogError, setRouterCatalogError] = useState<string | undefined>();
  const [routerCatalogLoading, setRouterCatalogLoading] = useState(false);
  const [providerSecret, setProviderSecret] = useState("");
  const [providerBusy, setProviderBusy] = useState<string | undefined>();
  const [accountLoginPanels, setAccountLoginPanels] = useState<Record<AccountLoginProviderId, AccountLoginPanelState>>({
    "openai-codex": initialAccountLoginPanelState,
    "anthropic-claude": initialAccountLoginPanelState,
  });
  const [connectedAccounts, setConnectedAccounts] = useState<Record<AccountLoginProviderId, boolean>>({
    "openai-codex": false,
    "anthropic-claude": false,
  });
  const accountLoginRefs = useRef<Record<AccountLoginProviderId, { loginId?: string; abort?: AbortController }>>({
    "openai-codex": {},
    "anthropic-claude": {},
  });
  const isDark = theme === "dark";

  const loadSettings = () => {
    setSettingsLoading(true);
    setSettingsError(undefined);
    void settingsStore.current!.load()
      .then((value) => { setSettings(value); })
      .catch((cause: unknown) => { if (isSessionFailure(cause)) reportSessionFailure(cause); setSettings(undefined); setSettingsError("Durable settings are unavailable. No settings were loaded."); })
      .finally(() => setSettingsLoading(false));
  };
  const loadRouterCatalog = useCallback(() => {
    setRouterCatalogLoading(true);
    setRouterCatalogError(undefined);
    void window.maestro.api.getRouterCatalog().then(setRouterCatalog).catch(() => {
      setRouterCatalog(undefined);
      setRouterCatalogError("Router Catalog is unavailable. No routing state was loaded.");
    }).finally(() => setRouterCatalogLoading(false));
  }, []);
  useEffect(() => {
    loadSettings();
    void settingsStore.current!.listProviderConnections().then((connections) => {
      setConnectedAccounts((current) => ({
        "openai-codex":
          current["openai-codex"] ||
          connections.some((provider) => provider.providerId === "openai-codex" && provider.connected),
        "anthropic-claude":
          current["anthropic-claude"] ||
          connections.some((provider) => provider.providerId === "anthropic-claude" && provider.connected),
      }));
    }).catch(() => { /* durable settings remains the source of truth when this optional refresh is unavailable */ });
    return () => {
      accountLoginRefs.current["openai-codex"].abort?.abort();
      accountLoginRefs.current["anthropic-claude"].abort?.abort();
    };
  }, []);
  useEffect(() => {
    if (panel === "models") loadRouterCatalog();
  }, [loadRouterCatalog, panel]);
  // A failed write must not hide the last server-confirmed snapshot.
  const settingsReady = settings !== undefined;
  const updatePreferences = (patch: Parameters<typeof window.maestro.api.updateSettingsPreferences>[0]) => {
    void settingsStore.current!.updatePreferences(patch)
      .then((value) => { setSettings(value); setSettingsError(undefined); })
      .catch(() => setSettingsError("Durable settings update failed; saved values remain unchanged."));
  };
  const updateDefaults = (patch: Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0]) => {
    void settingsStore.current!.updateAuthorityDefaults(patch)
      .then((value) => { setSettings(value); setSettingsError(undefined); setPendingAuthority(undefined); })
      .catch(() => setSettingsError("Durable settings update failed; saved values remain unchanged."));
  };
  const requestAuthorityUpdate = (patch: Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0]) => {
    if (settings === undefined) return;
    if (raisesAuthority(settings.authorityDefaults, patch)) setPendingAuthority(patch);
    else updateDefaults(patch);
  };
  const toggleRouterModel = async (modelRef: string, inUse: boolean) => {
    if (routerCatalog === undefined) throw new Error("Router Catalog is not loaded");
    const input: RouterConfigInput = { schemaVersion: 1, enabledModelRefs: nextRouterPool(routerCatalog, modelRef, inUse) };
    const next = await window.maestro.api.replaceRouterConfig(input);
    setRouterCatalog(next);
  };
  const validateRouterConfig = (input: RouterConfigInput) => window.maestro.api.validateRouterConfig(input);
  const applyRouterConfig = async (input: RouterConfigInput) => {
    const next = await window.maestro.api.replaceRouterConfig(input);
    setRouterCatalog(next);
    return next;
  };
  const providers = settings?.providers ?? [];
  const isAccountProviderConnected = (providerId: AccountLoginProviderId) =>
    connectedAccounts[providerId] || providers.some((provider) => provider.providerId === providerId && provider.connected);
  const refreshProviderSettings = async () => {
    const nextSettings = await settingsStore.current!.load();
    setSettings(nextSettings);
    setSettingsError(undefined);
    try {
      const connections = await settingsStore.current!.listProviderConnections();
      setConnectedAccounts((current) => ({
        "openai-codex":
          current["openai-codex"] ||
          connections.some((provider) => provider.providerId === "openai-codex" && provider.connected),
        "anthropic-claude":
          current["anthropic-claude"] ||
          connections.some((provider) => provider.providerId === "anthropic-claude" && provider.connected),
      }));
    } catch {
      // The completed login is still reflected locally while the gateway catalog catches up.
    }
  };
  const providerAction = async (providerId: "openai" | "anthropic") => {
    setProviderBusy(providerId);
    try {
      if (providers.some((provider) => provider.providerId === providerId && provider.connected)) {
        await settingsStore.current!.logoutProvider(providerId);
      } else if (providerSecret.trim() !== "") {
        await settingsStore.current!.loginProvider({ providerId, authMode: "api-key", secret: providerSecret });
      } else {
        return;
      }
      await refreshProviderSettings();
    } catch (cause: unknown) {
      if (isSessionFailure(cause)) reportSessionFailure(cause);
      const message = cause instanceof Error ? cause.message : "Provider status is unavailable; no connection state was changed.";
      setSettingsError(redactSecret(message, providerSecret));
    } finally {
      // Never retain or render a provider credential after the request settles.
      setProviderSecret("");
      setProviderBusy(undefined);
    }
  };
  const setAccountPanelState = (providerId: AccountLoginProviderId, patch: Partial<AccountLoginPanelState>) => {
    setAccountLoginPanels((current) => ({ ...current, [providerId]: { ...current[providerId], ...patch } }));
  };
  const setAccountConnectedFor = (providerId: AccountLoginProviderId, connected: boolean) => {
    setConnectedAccounts((current) => ({ ...current, [providerId]: connected }));
  };
  const accountLoginControllers: Record<AccountLoginProviderId, ReturnType<typeof createAccountLoginController>> = {
    "openai-codex": createAccountLoginController({
      providerId: "openai-codex",
      label: "ChatGPT / Codex",
      ref: accountLoginRefs.current["openai-codex"],
      api: window.maestro.api,
      openExternal: window.maestro.external.openProviderAuth,
      refreshProviderSettings,
      getBusy: () => providerBusy,
      setBusy: setProviderBusy,
      setPanelState: (patch) => setAccountPanelState("openai-codex", patch),
      setConnected: (connected) => setAccountConnectedFor("openai-codex", connected),
    }),
    "anthropic-claude": createAccountLoginController({
      providerId: "anthropic-claude",
      label: "Claude Pro/Max",
      ref: accountLoginRefs.current["anthropic-claude"],
      api: window.maestro.api,
      openExternal: window.maestro.external.openProviderAuth,
      refreshProviderSettings,
      getBusy: () => providerBusy,
      setBusy: setProviderBusy,
      setPanelState: (patch) => setAccountPanelState("anthropic-claude", patch),
      setConnected: (connected) => setAccountConnectedFor("anthropic-claude", connected),
    }),
  };

  const navItem = (id: Panel, icon: string, label: string) => (
    <button
      key={id}
      type="button"
      className={`settings-nav-item${panel === id ? " on" : ""}`}
      aria-current={panel === id ? "page" : undefined}
      onClick={() => setPanel(id)}
    >
      <Icon name={icon} /> {label}
    </button>
  );

  return (
    <div className="settings-wrap">
      <div className="settings-nav">
        <div className="settings-nav-group-label">account</div>
        {navItem("profile", "user", "profile")}
        {navItem("appearance", "palette", "appearance")}
        {navItem("notifications", "bell", "notifications")}

        {navItem("connection", "server", "connection")}

        <div className="settings-nav-group-label">workspace</div>
        {navItem("providers", "plug", "providers")}
        {navItem("models", "cpu", "Ensemble Router")}
        {navItem("authority", "shield", "approvals & authority")}

        <div className="settings-nav-divider" />
        {navItem("danger", "triangle-alert", "danger zone")}
      </div>

      <main className="settings-content">
      <div className="settings-status" role="status">
        {settingsLoading ? <span>Loading durable settings…</span> : settingsError ? <><span role="alert">{settingsError}</span> <button className="btn btn-sm" onClick={loadSettings}>retry</button></> : <span>Durable settings loaded.</span>}
      </div>

      {panel === "profile" && (
        <div className="settings-panel">
          <div className="settings-section-title">profile</div>
          <div className="settings-section-sub">profile editing is unavailable until a durable profile route exists</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div className="avatar avatar-lg av-slate" aria-label="Profile identity unavailable">--</div>
            <button className="btn btn-sm" disabled title="Profile editing is not connected to a durable route">change avatar</button>
          </div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label" htmlFor="settings-display-name">display name</label>
            <input id="settings-display-name" className="input" type="text" value="Unavailable" readOnly disabled />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="settings-email">email</label>
            <input id="settings-email" className="input" type="text" value="Unavailable" readOnly disabled />
            <span className="form-hint">used for critical-action email alerts</span>
          </div>
        </div>
      )}

      {panel === "appearance" && (
        <div className="settings-panel">
          <div className="settings-section-title">appearance</div>
          <div className="settings-section-sub">theme and density</div>
          <div className="settings-row">
            <div><div className="settings-row-label">dark mode</div><div className="settings-row-hint">follows this toggle, not the OS setting</div></div>
            <ToggleSwitch label="Dark mode" on={isDark} onToggle={() => setTheme(isDark ? "light" : "dark")} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">compact sidebar</div><div className="settings-row-hint">start collapsed on launch</div></div>
            {settingsReady ? <ToggleSwitch label="Compact sidebar" on={settings.preferences.compactSidebar} onToggle={() => updatePreferences({ compactSidebar: !settings.preferences.compactSidebar })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "connection" && (
        <div className="settings-panel">
          <div className="settings-section-title">connection</div>
          <div className="settings-section-sub">the real control plane this Carnegie instance is connected to</div>
          {config === undefined ? (
            <p>Not connected.</p>
          ) : (
            <>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label className="form-label" htmlFor="settings-control-plane-url">control plane URL</label>
                <input id="settings-control-plane-url" className="input" type="text" value={config.apiUrl} readOnly />
              </div>
              <div className="form-field" style={{ marginBottom: 20 }}>
                <label className="form-label" htmlFor="settings-project-id">project ID</label>
                <input id="settings-project-id" className="input" type="text" value={config.projectId} readOnly />
              </div>
              <button
                className="btn btn-sm"
                style={{ borderColor: "var(--rust)", color: "var(--rust-text)" }}
                disabled={disconnecting}
                onClick={() => {
                  setDisconnecting(true);
                  void disconnect().finally(() => setDisconnecting(false));
                }}
              >
                {disconnecting ? "disconnecting…" : "disconnect"}
              </button>
            </>
          )}
        </div>
      )}

      {panel === "notifications" && (
        <div className="settings-panel">
          <div className="settings-section-title">notifications</div>
          <div className="settings-section-sub">how you hear about approvals and certifications</div>
          <div className="settings-row">
            <div><div className="settings-row-label">desktop push</div><div className="settings-row-hint">approval needed, certification complete</div></div>
            {settingsReady ? <ToggleSwitch label="Desktop push" on={settings.preferences.desktopPush} onToggle={() => updatePreferences({ desktopPush: !settings.preferences.desktopPush })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">email digest</div><div className="settings-row-hint">daily summary of goal activity</div></div>
            {settingsReady ? <ToggleSwitch label="Email digest" on={settings.preferences.emailDigest} onToggle={() => updatePreferences({ emailDigest: !settings.preferences.emailDigest })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">slack webhook</div><div className="settings-row-hint">mirror #general into a workspace channel</div></div>
            {settingsReady ? <ToggleSwitch label="Slack webhook" on={settings.preferences.slackWebhook} onToggle={() => updatePreferences({ slackWebhook: !settings.preferences.slackWebhook })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "providers" && (
        <div className="settings-panel settings-panel-wide">
          <div className="settings-section-title">providers</div>
          <div className="settings-section-sub">Connect a model provider once. Credentials stay behind the authenticated Model Gateway.</div>
          {settingsReady ? <>
            {(
              [
                {
                  providerId: "openai-codex" as const,
                  icon: "message-circle",
                  title: "ChatGPT / Codex",
                  description: "Use your existing ChatGPT account for Maestro. Carnegie opens the secure sign-in in your browser.",
                  connectLabel: "sign in with ChatGPT",
                },
                {
                  providerId: "anthropic-claude" as const,
                  icon: "message-circle",
                  title: "Claude Pro/Max",
                  description: "Use your existing Claude Pro/Max account for Maestro. Carnegie opens the secure sign-in in your browser.",
                  connectLabel: "sign in with Claude",
                },
              ] as const
            ).map(({ providerId, icon, title, description, connectLabel }) => {
              const connected = isAccountProviderConnected(providerId);
              const panelState = accountLoginPanels[providerId];
              const controller = accountLoginControllers[providerId];
              return (
                <section className="provider-account-card" aria-labelledby={`${providerId}-provider-title`} key={providerId}>
                  <div className="provider-account-head">
                    <div className="provider-account-icon"><Icon name={icon} /></div>
                    <div className="provider-account-copy">
                      <h2 id={`${providerId}-provider-title`}>{title}</h2>
                      <p>{description}</p>
                    </div>
                    <span
                      className={`badge ${connected ? "badge-olive" : panelState.loginState === "error" ? "badge-rust" : "badge-slate"}`}
                    >
                      {connected
                        ? "connected"
                        : panelState.loginState === "waiting"
                          ? "waiting for sign-in"
                          : panelState.loginState === "opening"
                            ? "opening browser"
                            : panelState.loginState === "error"
                              ? "needs attention"
                              : "not connected"}
                    </span>
                  </div>
                  <div className="provider-account-actions">
                    {connected ? (
                      <button className="btn btn-sm" disabled={providerBusy === providerId} onClick={() => void controller.logout()}>
                        {providerBusy === providerId ? "disconnecting…" : "disconnect"}
                      </button>
                    ) : panelState.loginState === "waiting" || panelState.loginState === "opening" ? (
                      <button className="btn btn-sm" disabled={providerBusy !== undefined} onClick={() => void controller.cancel()}>
                        cancel sign-in
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={providerBusy !== undefined}
                        onClick={() => void controller.start()}
                      >
                        {panelState.loginState === "error" ? "try again" : connectLabel}
                      </button>
                    )}
                    {panelState.message !== undefined && (
                      <span
                        className={`provider-account-message ${
                          panelState.loginState === "error" ? "is-error" : panelState.loginState === "connected" ? "is-success" : ""
                        }`}
                        role={panelState.loginState === "error" ? "alert" : "status"}
                      >
                        {panelState.message}
                      </span>
                    )}
                  </div>
                  {panelState.url !== undefined && panelState.loginState !== "connected" && (
                    <div className="provider-account-link-box">
                      <span>Sign-in link</span>
                      <div className="provider-account-link-row">
                        <a href={panelState.url} target="_blank" rel="noreferrer">{panelState.url}</a>
                        <button type="button" className="btn btn-sm" onClick={() => void controller.copyLink(panelState.url)}>
                          {panelState.linkCopied ? "copied" : "copy link"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}

            <div className="provider-api-section">
              <div className="provider-api-heading">API key connections</div>
              <div className="form-field"><label className="form-label" htmlFor="provider-secret">API key</label><input id="provider-secret" className="input" type="password" value={providerSecret} onChange={(event) => setProviderSecret(event.target.value)} placeholder="enter only when connecting" /></div>
              {(["openai", "anthropic"] as const).map((providerId) => { const connected = providers.some((provider) => provider.providerId === providerId && provider.connected); return <div key={providerId} className="provider-row"><Icon name="server" /><span className="provider-row-name">{providerId}</span><span className={`badge ${connected ? "badge-olive" : "badge-slate"}`}>{connected ? "connected" : "not connected"}</span><button className="btn btn-sm" disabled={providerBusy === providerId || (!connected && providerSecret.trim() === "")} onClick={() => void providerAction(providerId)}>{providerBusy === providerId ? "working…" : connected ? "disconnect" : "connect"}</button></div>; })}
            </div>
          </> : <p role="status">Provider status unavailable until durable settings load successfully.</p>}
        </div>
      )}
      {panel === "authority" && (
        <div className="settings-panel">
          <div className="settings-section-title">approvals &amp; authority</div>
          <div className="settings-section-sub">durable defaults applied when new Goals are created</div>
          {pendingAuthority !== undefined && (
            <div className="alert alert-warning" role="alert">
              <strong>This change raises default authority.</strong> New Goals may spend more or skip an approval gate.
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => updateDefaults(pendingAuthority)}>confirm and save</button>
                <button type="button" className="btn btn-sm" onClick={() => setPendingAuthority(undefined)}>cancel</button>
              </div>
            </div>
          )}
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label" htmlFor="settings-spend-ceiling">default spend ceiling per goal</label>
            <input id="settings-spend-ceiling" className="input" type="number" min="0" value={settingsReady ? settings.authorityDefaults.spendCeilingCents / 100 : ""} placeholder={settingsReady ? undefined : "unavailable"} disabled={!settingsReady} onChange={(event) => requestAuthorityUpdate({ spendCeilingCents: Math.max(0, Math.round(Number(event.target.value || 0) * 100)) })} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">critical actions always require approval</div><div className="settings-row-hint">deletes, deploys, credential changes</div></div>
            {settingsReady ? <ToggleSwitch label="Critical actions always require approval" on={settings.authorityDefaults.criticalActionsRequireApproval} onToggle={() => requestAuthorityUpdate({ criticalActionsRequireApproval: !settings.authorityDefaults.criticalActionsRequireApproval })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">allow flashmob by default</div><div className="settings-row-hint">light tasks skip full council deliberation</div></div>
            {settingsReady ? <ToggleSwitch label="Allow Flashmob by default" on={settings.authorityDefaults.allowFlashmob} onToggle={() => requestAuthorityUpdate({ allowFlashmob: !settings.authorityDefaults.allowFlashmob })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "models" && (
        <RouterCatalogPanel
          catalog={routerCatalog}
          loading={routerCatalogLoading}
          error={routerCatalogError}
          onRefresh={loadRouterCatalog}
          onToggle={toggleRouterModel}
          onValidateConfig={validateRouterConfig}
          onApplyConfig={applyRouterConfig}
        />
      )}

      {panel === "danger" && (
        <div className="settings-panel">
          <div className="settings-section-title">danger zone</div>
          <div className="settings-section-sub">irreversible actions</div>
          <div className="danger-box">
            <div className="danger-box-title">reset workspace</div>
            <div className="danger-box-hint">preview only -- not wired to a real backend yet. clearing durable Goals/evidence must go through the control plane's own authority checks, not this button.</div>
            <button className="btn btn-sm" style={{ borderColor: "var(--rust)", color: "var(--rust-text)" }} disabled title="Not wired to a real backend yet">reset workspace</button>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
