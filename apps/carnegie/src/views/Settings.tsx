import { useEffect, useState } from "react";
import { Icon } from "../icons.js";
import { useTheme } from "../theme.js";
import { useConnection } from "../connection.js";
import { ToggleSwitch } from "../components/ToggleSwitch.js";

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
  const isDark = theme === "dark";

  const loadSettings = () => {
    setSettingsLoading(true);
    setSettingsError(undefined);
    void window.maestro.api.getSettings().then((value) => { setSettings(value); }).catch(() => { setSettings(undefined); setSettingsError("Durable settings are unavailable. No settings were loaded."); }).finally(() => setSettingsLoading(false));
  };
  useEffect(() => { loadSettings(); }, []);
  const settingsReady = settings !== undefined && settingsError === undefined;
  const updatePreferences = (patch: Parameters<typeof window.maestro.api.updateSettingsPreferences>[0]) => { void window.maestro.api.updateSettingsPreferences(patch).then(setSettings).catch(() => setSettingsError("Durable settings update failed; displayed values may be stale.")); };
  const updateDefaults = (patch: Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0]) => { void window.maestro.api.updateSettingsAuthorityDefaults(patch).then(setSettings).catch(() => setSettingsError("Durable settings update failed; displayed values may be stale.")); };
  const models = settings?.models ?? [];
  const filteredAvailable = models.filter((model) => !model.inUse && model.modelRef.toLowerCase().includes(modelSearch.toLowerCase()));
  const inUseModels = models.filter((model) => model.inUse);
  const providers = settings?.providers ?? [];
  const providerAction = async (providerId: "openai" | "anthropic") => {
    setProviderBusy(providerId);
    try { if (providers.some((provider) => provider.providerId === providerId && provider.connected)) await window.maestro.api.logoutProvider(providerId); else if (providerSecret.trim() !== "") await window.maestro.api.loginProvider({ providerId, authMode: "api-key", secret: providerSecret }); else return; setProviderSecret(""); setSettings(await window.maestro.api.getSettings()); setSettingsError(undefined); } catch { setSettingsError("Provider status is unavailable; no connection state was changed."); } finally { setProviderBusy(undefined); }
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

      <div className="settings-panel" role="status" style={{ marginBottom: 12 }}>
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
        <div className="settings-panel">
          <div className="settings-section-title">providers</div>
          <div className="settings-section-sub">provider credentials are stored by the authenticated Model Gateway</div>
          {settingsReady ? <>
            <div className="form-field" style={{ marginBottom: 14 }}><label className="form-label">API key</label><input className="input" type="password" value={providerSecret} onChange={(event) => setProviderSecret(event.target.value)} placeholder="enter only when connecting" /></div>
            {(["openai", "anthropic"] as const).map((providerId) => { const connected = providers.some((provider) => provider.providerId === providerId && provider.connected); return <div key={providerId} className="provider-row"><Icon name="server" /><span className="provider-row-name">{providerId}</span><span className="badge">{connected ? "connected" : "not connected"}</span><button className="btn btn-sm" disabled={providerBusy === providerId || (!connected && providerSecret.trim() === "")} onClick={() => void providerAction(providerId)}>{providerBusy === providerId ? "working…" : connected ? "disconnect" : "connect"}</button></div>; })}
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
            <div><div className="settings-row-label">auto-select models</div><div className="settings-row-hint">orchestrator swaps models on the fly to fit each task. off · strictly uses the assignments below</div></div>
            <span className="badge">human-managed pool</span>
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
    </div>
  );
}
