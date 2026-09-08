import { useState } from "react";
import { Icon } from "../icons.js";
import { useTheme } from "../theme.js";
import { useConnection } from "../connection.js";
import { ToggleSwitch } from "../components/ToggleSwitch.js";

type Panel = "profile" | "appearance" | "connection" | "notifications" | "providers" | "models" | "authority" | "danger";

const inUseModels = [
  { name: "claude-opus-5", score: 9.5, role: "department heads, encore council" },
  { name: "claude-sonnet-5", score: 6.5, role: "default worker" },
  { name: "claude-haiku-4.5", score: 3.0, role: "flashmob, scouts" },
  { name: "gpt-5-codex", score: 8.0, role: "engineering workers" },
];

const availableModels = [
  { name: "claude fable 5.1", score: 9.0 },
  { name: "grok-code", score: 7.0 },
  { name: "kimi-code", score: 5.5 },
  { name: "qwen3-coder", score: 4.5 },
  { name: "local (ollama llama)", score: 1.5 },
];

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { config, disconnect } = useConnection();
  const [disconnecting, setDisconnecting] = useState(false);
  const [panel, setPanel] = useState<Panel>("profile");
  const [compactSidebar, setCompactSidebar] = useState(false);
  const [desktopPush, setDesktopPush] = useState(true);
  const [emailDigest, setEmailDigest] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState(false);
  const [criticalApproval, setCriticalApproval] = useState(true);
  const [allowFlashmob, setAllowFlashmob] = useState(true);
  const [autoSelectModels, setAutoSelectModels] = useState(true);
  const [modelTab, setModelTab] = useState<"inuse" | "available">("inuse");
  const [modelSearch, setModelSearch] = useState("");

  const isDark = theme === "dark";
  const filteredAvailable = availableModels.filter((model) => model.name.toLowerCase().includes(modelSearch.toLowerCase()));

  const navItem = (id: Panel, icon: string, label: string) => (
    <div key={id} className={`settings-nav-item${panel === id ? " on" : ""}`} onClick={() => setPanel(id)}>
      <Icon name={icon} /> {label}
    </div>
  );

  return (
    <div className="settings-wrap">
      <div className="settings-nav">
        <div className="settings-nav-group-label">account</div>
        {navItem("profile", "user", "profile")}
        {navItem("appearance", "palette", "appearance")}
        {navItem("notifications", "bell", "notifications")}

        {navItem("connection", "server", "connection")}

        <div className="settings-nav-group-label">workspace (preview -- not wired to a real backend yet)</div>
        {navItem("providers", "plug", "providers")}
        {navItem("models", "cpu", "model pool")}
        {navItem("authority", "shield", "approvals & authority")}

        <div className="settings-nav-divider" />
        {navItem("danger", "triangle-alert", "danger zone")}
      </div>

      {panel === "profile" && (
        <div className="settings-panel">
          <div className="settings-section-title">profile</div>
          <div className="settings-section-sub">how the concertmaster addresses you</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div className="avatar avatar-lg av-slate">ND</div>
            <button className="btn btn-sm">change avatar</button>
          </div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label">display name</label>
            <input className="input" type="text" defaultValue="ntdv" />
          </div>
          <div className="form-field">
            <label className="form-label">email</label>
            <input className="input" type="text" defaultValue="ntdv@notth3.dev" />
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
            <ToggleSwitch on={compactSidebar} onToggle={() => setCompactSidebar((current) => !current)} />
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
            <ToggleSwitch on={desktopPush} onToggle={() => setDesktopPush((current) => !current)} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">email digest</div><div className="settings-row-hint">daily summary of goal activity</div></div>
            <ToggleSwitch on={emailDigest} onToggle={() => setEmailDigest((current) => !current)} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">slack webhook</div><div className="settings-row-hint">mirror #general into a workspace channel</div></div>
            <ToggleSwitch on={slackWebhook} onToggle={() => setSlackWebhook((current) => !current)} />
          </div>
        </div>
      )}

      {panel === "providers" && (
        <div className="settings-panel">
          <div className="settings-section-title">providers</div>
          <div className="settings-section-sub">preview only -- provider connection management isn't wired to a real backend yet; nothing here reflects or changes actual state</div>
          <div className="provider-row"><Icon name="terminal" /><span className="provider-row-name">claude code</span><span className="badge">not wired</span></div>
          <div className="provider-row"><Icon name="terminal" /><span className="provider-row-name">codex</span><span className="badge">not wired</span></div>
          <div className="provider-row"><Icon name="terminal" /><span className="provider-row-name">gemini cli</span><button className="btn btn-sm" disabled title="Not wired to a real backend yet">connect</button></div>
          <div className="provider-row"><Icon name="server" /><span className="provider-row-name">local model (ollama)</span><button className="btn btn-sm" disabled title="Not wired to a real backend yet">connect</button></div>
        </div>
      )}

      {panel === "authority" && (
        <div className="settings-panel">
          <div className="settings-section-title">approvals &amp; authority</div>
          <div className="settings-section-sub">preview only -- these defaults aren't wired to a real backend yet; per-Goal critical-action approval already works today through the Dashboard's lifecycle controls</div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label">default spend ceiling per goal</label>
            <input className="input" type="text" defaultValue="$50" />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">critical actions always require approval</div><div className="settings-row-hint">deletes, deploys, credential changes</div></div>
            <ToggleSwitch on={criticalApproval} onToggle={() => setCriticalApproval((current) => !current)} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">allow flashmob by default</div><div className="settings-row-hint">light tasks skip full council deliberation</div></div>
            <ToggleSwitch on={allowFlashmob} onToggle={() => setAllowFlashmob((current) => !current)} />
          </div>
        </div>
      )}

      {panel === "models" && (
        <div className="settings-panel">
          <div className="settings-section-title">model pool</div>
          <div className="settings-section-sub">preview only -- model routing isn't wired to a real backend yet; scores and roles below are illustrative, not live</div>

          <div className="settings-row" style={{ marginBottom: 6 }}>
            <div><div className="settings-row-label">auto-select models</div><div className="settings-row-hint">orchestrator swaps models on the fly to fit each task. off · strictly uses the assignments below</div></div>
            <ToggleSwitch on={autoSelectModels} onToggle={() => setAutoSelectModels((current) => !current)} />
          </div>

          <div className="page-tabs" style={{ padding: 0, margin: "14px 0 0" }}>
            <div className={`page-tab${modelTab === "inuse" ? " on" : ""}`} onClick={() => setModelTab("inuse")}>in use</div>
            <div className={`page-tab${modelTab === "available" ? " on" : ""}`} onClick={() => setModelTab("available")}>available <span style={{ fontSize: 10 }}>(search)</span></div>
          </div>

          {modelTab === "inuse" && (
            <div style={{ padding: "14px 0 0" }}>
              {inUseModels.map((model) => (
                <div key={model.name} className="model-row">
                  <span className="model-name">{model.name}</span>
                  <div className="model-score-track"><div className="model-score-fill" style={{ width: `${model.score * 10}%` }} /></div>
                  <span className="model-score-label">{model.score.toFixed(1)}</span>
                  <span className="model-role-tag" style={{ marginLeft: "auto" }}>{model.role}</span>
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
                <div key={model.name} className="model-row">
                  <span className="model-name">{model.name}</span>
                  <div className="model-score-track"><div className="model-score-fill" style={{ width: `${model.score * 10}%` }} /></div>
                  <span className="model-score-label">{model.score.toFixed(1)}</span>
                  <button className="btn btn-sm" style={{ marginLeft: "auto" }} disabled title="Not wired to a real backend yet">add to pool</button>
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
