import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons.js";
import { useTheme } from "../theme.js";
import { useConnection } from "../connection.js";
import { ToggleSwitch } from "../components/ToggleSwitch.js";
import { isProviderAuthUrlAllowed, waitForProviderAccountLogin } from "../lib/provider-account-login.js";

type Panel = "profile" | "appearance" | "connection" | "notifications" | "providers" | "models" | "authority" | "danger";

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { config, disconnect } = useConnection();
  const [disconnecting, setDisconnecting] = useState(false);
  const [panel, setPanel] = useState<Panel>("profile");
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof window.maestro.api.getSettings>> | undefined>();
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [modelTab, setModelTab] = useState<"inuse" | "available">("inuse");
  const [modelSearch, setModelSearch] = useState("");
  const [providerSecret, setProviderSecret] = useState("");
  const [providerBusy, setProviderBusy] = useState<string | undefined>();
  const [accountLoginState, setAccountLoginState] = useState<"idle" | "opening" | "waiting" | "connected" | "error">("idle");
  const [accountLoginMessage, setAccountLoginMessage] = useState<string | undefined>();
  const [accountLoginUrl, setAccountLoginUrl] = useState<string | undefined>();
  const [accountLinkCopied, setAccountLinkCopied] = useState(false);
  const [accountConnected, setAccountConnected] = useState(false);
  const accountLoginId = useRef<string | undefined>(undefined);
  const accountLoginAbort = useRef<AbortController | undefined>(undefined);
  const isDark = theme === "dark";

  const loadSettings = () => {
    setSettingsLoading(true);
    setSettingsError(undefined);
    void window.maestro.api.getSettings().then((value) => { setSettings(value); }).catch(() => { setSettings(undefined); setSettingsError("Durable settings are unavailable. No settings were loaded."); }).finally(() => setSettingsLoading(false));
  };
  useEffect(() => {
    loadSettings();
    void window.maestro.api.listProviderConnections().then((connections) => {
      setAccountConnected(connections.some((provider) => provider.providerId === "openai-codex" && provider.connected));
    }).catch(() => { /* durable settings remains the source of truth when this optional refresh is unavailable */ });
    return () => accountLoginAbort.current?.abort();
  }, []);
  const settingsReady = settings !== undefined && settingsError === undefined;
  const updatePreferences = (patch: Parameters<typeof window.maestro.api.updateSettingsPreferences>[0]) => { void window.maestro.api.updateSettingsPreferences(patch).then(setSettings).catch(() => setSettingsError("Durable settings update failed; displayed values may be stale.")); };
  const updateDefaults = (patch: Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0]) => { void window.maestro.api.updateSettingsAuthorityDefaults(patch).then(setSettings).catch(() => setSettingsError("Durable settings update failed; displayed values may be stale.")); };
  const models = settings?.models ?? [];
  const filteredAvailable = models.filter((model) => !model.inUse && model.modelRef.toLowerCase().includes(modelSearch.toLowerCase()));
  const inUseModels = models.filter((model) => model.inUse);
  const providers = settings?.providers ?? [];
  const codexConnected = accountConnected || providers.some((provider) => provider.providerId === "openai-codex" && provider.connected);
  const refreshProviderSettings = async () => {
    const nextSettings = await window.maestro.api.getSettings();
    setSettings(nextSettings);
    setSettingsError(undefined);
    try {
      const connections = await window.maestro.api.listProviderConnections();
      const connected = connections.some((provider) => provider.providerId === "openai-codex" && provider.connected);
      setAccountConnected((current) => current || connected);
    } catch {
      // The completed login is still reflected locally while the gateway catalog catches up.
    }
  };
  const providerAction = async (providerId: "openai" | "anthropic") => {
    setProviderBusy(providerId);
    try { if (providers.some((provider) => provider.providerId === providerId && provider.connected)) await window.maestro.api.logoutProvider(providerId); else if (providerSecret.trim() !== "") await window.maestro.api.loginProvider({ providerId, authMode: "api-key", secret: providerSecret }); else return; setProviderSecret(""); await refreshProviderSettings(); } catch { setSettingsError("Provider status is unavailable; no connection state was changed."); } finally { setProviderBusy(undefined); }
  };
  const startCodexLogin = async () => {
    if (providerBusy !== undefined) return;
    const controller = new AbortController();
    accountLoginAbort.current = controller;
    accountLoginId.current = undefined;
    setProviderBusy("openai-codex");
    setAccountLoginState("opening");
    setAccountLoginMessage(undefined);
    try {
      const started = await window.maestro.api.startAccountLogin();
      if (!isProviderAuthUrlAllowed(started.authUrl)) throw new Error("The provider returned an unsafe authentication URL.");
      accountLoginId.current = started.loginId;
      setAccountLoginUrl(started.authUrl);
      let browserOpened = true;
      try {
        await window.maestro.external.openProviderAuth(started.authUrl);
      } catch {
        browserOpened = false;
      }
      setAccountLoginState("waiting");
      if (!browserOpened) setAccountLoginMessage("The browser did not open. Use the sign-in link below.");
      await waitForProviderAccountLogin((loginId) => window.maestro.api.accountLoginStatus(loginId), started.loginId, { signal: controller.signal });
      setAccountConnected(true);
      setAccountLoginState("connected");
      try {
        await refreshProviderSettings();
        setAccountLoginMessage("ChatGPT / Codex is ready for Maestro.");
      } catch {
        setAccountLoginMessage("ChatGPT / Codex is connected. Settings will refresh on the next load.");
      }
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const loginId = accountLoginId.current;
      if (loginId !== undefined) {
        try { await window.maestro.api.cancelAccountLogin(loginId); } catch { /* preserve the original sign-in error */ }
      }
      setAccountLoginState("error");
      setAccountLoginMessage(cause instanceof Error ? cause.message : "Could not complete ChatGPT / Codex login.");
    } finally {
      if (accountLoginAbort.current === controller) accountLoginAbort.current = undefined;
      accountLoginId.current = undefined;
      setProviderBusy(undefined);
    }
  };
  const copyAccountLoginUrl = async () => {
    if (accountLoginUrl === undefined) return;
    try {
      await navigator.clipboard.writeText(accountLoginUrl);
      setAccountLinkCopied(true);
      window.setTimeout(() => setAccountLinkCopied(false), 1800);
    } catch {
      setAccountLoginMessage("Copy was blocked. Select the sign-in link manually.");
    }
  };
  const cancelCodexLogin = async () => {
    const loginId = accountLoginId.current;
    accountLoginAbort.current?.abort();
    if (loginId !== undefined) {
      try { await window.maestro.api.cancelAccountLogin(loginId); } catch { /* the local cancellation still stops polling */ }
    }
    accountLoginId.current = undefined;
    accountLoginAbort.current = undefined;
    setProviderBusy(undefined);
    setAccountLoginState("idle");
    setAccountLoginMessage(undefined);
    setAccountLoginUrl(undefined);
    setAccountLinkCopied(false);
  };
  const logoutCodex = async () => {
    setProviderBusy("openai-codex");
    try {
      await window.maestro.api.logoutAccount();
      setAccountConnected(false);
      setAccountLoginState("idle");
      setAccountLoginMessage(undefined);
      setAccountLoginUrl(undefined);
      setAccountLinkCopied(false);
      await refreshProviderSettings();
    } catch (cause: unknown) {
      setAccountLoginState("error");
      setAccountLoginMessage(cause instanceof Error ? cause.message : "Could not disconnect ChatGPT / Codex.");
    } finally {
      setProviderBusy(undefined);
    }
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
            <label className="form-label">display name</label>
            <input className="input" type="text" value="Unavailable" readOnly disabled />
          </div>
          <div className="form-field">
            <label className="form-label">email</label>
            <input className="input" type="text" value="Unavailable" readOnly disabled />
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
            <ToggleSwitch on={isDark} onToggle={() => setTheme(isDark ? "light" : "dark")} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">compact sidebar</div><div className="settings-row-hint">start collapsed on launch</div></div>
            {settingsReady ? <ToggleSwitch on={settings.preferences.compactSidebar} onToggle={() => updatePreferences({ compactSidebar: !settings.preferences.compactSidebar })} /> : <span className="badge">unavailable</span>}
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
                <label className="form-label">control plane URL</label>
                <input className="input" type="text" value={config.apiUrl} readOnly />
              </div>
              <div className="form-field" style={{ marginBottom: 20 }}>
                <label className="form-label">project ID</label>
                <input className="input" type="text" value={config.projectId} readOnly />
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
            {settingsReady ? <ToggleSwitch on={settings.preferences.desktopPush} onToggle={() => updatePreferences({ desktopPush: !settings.preferences.desktopPush })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">email digest</div><div className="settings-row-hint">daily summary of goal activity</div></div>
            {settingsReady ? <ToggleSwitch on={settings.preferences.emailDigest} onToggle={() => updatePreferences({ emailDigest: !settings.preferences.emailDigest })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">slack webhook</div><div className="settings-row-hint">mirror #general into a workspace channel</div></div>
            {settingsReady ? <ToggleSwitch on={settings.preferences.slackWebhook} onToggle={() => updatePreferences({ slackWebhook: !settings.preferences.slackWebhook })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "providers" && (
        <div className="settings-panel settings-panel-wide">
          <div className="settings-section-title">providers</div>
          <div className="settings-section-sub">Connect a model provider once. Credentials stay behind the authenticated Model Gateway.</div>
          {settingsReady ? <>
            <section className="provider-account-card" aria-labelledby="codex-provider-title">
              <div className="provider-account-head">
                <div className="provider-account-icon"><Icon name="message-circle" /></div>
                <div className="provider-account-copy">
                  <h2 id="codex-provider-title">ChatGPT / Codex</h2>
                  <p>Use your existing ChatGPT account for Maestro. Carnegie opens the secure sign-in in your browser.</p>
                </div>
                <span className={`badge ${codexConnected ? "badge-olive" : accountLoginState === "error" ? "badge-rust" : "badge-slate"}`}>
                  {codexConnected ? "connected" : accountLoginState === "waiting" ? "waiting for sign-in" : accountLoginState === "opening" ? "opening browser" : accountLoginState === "error" ? "needs attention" : "not connected"}
                </span>
              </div>
              <div className="provider-account-actions">
                {codexConnected ? (
                  <button className="btn btn-sm" disabled={providerBusy === "openai-codex"} onClick={() => void logoutCodex()}>
                    {providerBusy === "openai-codex" ? "disconnecting…" : "disconnect"}
                  </button>
                ) : accountLoginState === "waiting" || accountLoginState === "opening" ? (
                  <button className="btn btn-sm" disabled={providerBusy !== undefined} onClick={() => void cancelCodexLogin()}>cancel sign-in</button>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={providerBusy !== undefined} onClick={() => void startCodexLogin()}>
                    {accountLoginState === "error" ? "try again" : "sign in with ChatGPT"}
                  </button>
                )}
                {accountLoginMessage !== undefined && <span className={`provider-account-message ${accountLoginState === "error" ? "is-error" : accountLoginState === "connected" ? "is-success" : ""}`} role={accountLoginState === "error" ? "alert" : "status"}>{accountLoginMessage}</span>}
              </div>
              {accountLoginUrl !== undefined && accountLoginState !== "connected" && (
                <div className="provider-account-link-box">
                  <span>Sign-in link</span>
                  <div className="provider-account-link-row">
                    <a href={accountLoginUrl} target="_blank" rel="noreferrer">{accountLoginUrl}</a>
                    <button type="button" className="btn btn-sm" onClick={() => void copyAccountLoginUrl()}>{accountLinkCopied ? "copied" : "copy link"}</button>
                  </div>
                </div>
              )}
            </section>

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
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label">default spend ceiling per goal</label>
            <input className="input" type="number" min="0" value={settingsReady ? settings.authorityDefaults.spendCeilingCents / 100 : ""} placeholder={settingsReady ? undefined : "unavailable"} disabled={!settingsReady} onChange={(event) => updateDefaults({ spendCeilingCents: Math.max(0, Math.round(Number(event.target.value || 0) * 100)) })} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">critical actions always require approval</div><div className="settings-row-hint">deletes, deploys, credential changes</div></div>
            {settingsReady ? <ToggleSwitch on={settings.authorityDefaults.criticalActionsRequireApproval} onToggle={() => updateDefaults({ criticalActionsRequireApproval: !settings.authorityDefaults.criticalActionsRequireApproval })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">allow flashmob by default</div><div className="settings-row-hint">light tasks skip full council deliberation</div></div>
            {settingsReady ? <ToggleSwitch on={settings.authorityDefaults.allowFlashmob} onToggle={() => updateDefaults({ allowFlashmob: !settings.authorityDefaults.allowFlashmob })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "models" && (
        <div className="settings-panel">
          <div className="settings-section-title">Ensemble Router</div>
          <div className="settings-section-sub">human-owned model_map entries and operator pool</div>
          {!settingsReady && <p role="status">Model pool unavailable until durable settings load successfully.</p>}

          <div className="settings-row" style={{ marginBottom: 6 }}>
            <div><div className="settings-row-label">auto-select models</div><div className="settings-row-hint">orchestrator swaps models on the fly to fit each task. off · strictly uses the assignments below</div></div>d
          </div>

          <div className="page-tabs" style={{ padding: 0, margin: "14px 0 0" }}>
            <div className={`page-tab${modelTab === "inuse" ? " on" : ""}`} onClick={() => setModelTab("inuse")}>in use</div>
            <div className={`page-tab${modelTab === "available" ? " on" : ""}`} onClick={() => setModelTab("available")}>available <span style={{ fontSize: 10 }}>(search)</span></div>
          </div>

          {modelTab === "inuse" && (
            <div style={{ padding: "14px 0 0" }}>
              {inUseModels.map((model) => (
                <div key={model.modelRef} className="model-row">
                  <span className="model-name">{model.modelRef}</span>
                  <div className="model-score-track"><div className="model-score-fill" style={{ width: `${(model.score ?? 0) / 2}%` }} /></div>
                  <span className="model-score-label">{model.score === null ? "—" : model.score.toFixed(1)}</span>
                  <span className="model-role-tag" style={{ marginLeft: "auto" }}>{model.score === null ? "unproven" : `score ${model.score.toFixed(1)}`}</span><button className="btn btn-sm" onClick={() => void window.maestro.api.updateSettingsModelPool({ modelRef: model.modelRef, inUse: false }).then(setSettings)}>remove</button>
                </div>
              ))}
            </div>
          )}

          {modelTab === "available" && (
            <div style={{ padding: "14px 0 0" }}>
              <div className="model-list-toolbar">
                <input className="input" type="text" placeholder="search models" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} />
              </div>
              {filteredAvailable.map((model) => (
                <div key={model.modelRef} className="model-row">
                  <span className="model-name">{model.modelRef}</span>
                  <div className="model-score-track"><div className="model-score-fill" style={{ width: `${(model.score ?? 0) / 2}%` }} /></div>
                  <span className="model-score-label">{model.score === null ? "—" : model.score.toFixed(1)}</span>
                  <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => void window.maestro.api.updateSettingsModelPool({ modelRef: model.modelRef, inUse: true }).then(setSettings)}>add to pool</button>
                </div>
              ))}
            </div>
          )}
        </div>
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
