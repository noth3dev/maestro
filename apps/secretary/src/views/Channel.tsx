import { useState } from "react";
import { Icon } from "../icons.js";
import type { ViewName } from "../views.js";

export function Channel({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const [rosterHidden, setRosterHidden] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <div className="channel-wrap" style={{ position: "relative" }}>
      <div className="channel-feed">
        <div className="channel-head">
          <Icon name="code" /> engineering
          <span className="goalname">launch page</span>
          <div className="roster-toggle-btn" onClick={() => setRosterHidden((current) => !current)} title="toggle roster"><Icon name="panel-right" /></div>
        </div>
        <div className="channel-messages">
          <div className="msg">
            <div className="avatar avatar-sm av-teal">TH</div>
            <div className="msg-body">
              <div className="msg-head"><span className="msg-name">tech head</span><span className="msg-time">10:04</span></div>
              <div className="msg-text">mission bundle dispatched — hero section, read scope: /repo/marketing</div>
            </div>
          </div>

          <div className="msg">
            <div className="avatar avatar-sm av-terracotta">S1</div>
            <div className="msg-body">
              <div className="msg-head"><span className="msg-name">scout-1</span><span className="msg-time">10:06</span></div>
              <div className="msg-text">worktree created at .worktrees/hero-section</div>
            </div>
          </div>

          <div className="alert alert-warning" style={{ margin: "4px 0 14px 41px", flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><Icon name="triangle-alert" /> approval needed</div>
            <span>scout-1 requests write access outside allowlist: /repo/marketing/assets</span>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="btn btn-sm">deny</button>
              <button className="btn btn-primary btn-sm">approve</button>
            </div>
          </div>

          <div className="msg" onClick={() => onNavigate("git")} style={{ cursor: "pointer" }}>
            <div className="avatar avatar-sm" style={{ background: "var(--olive)" }}><Icon name="check" style={{ width: 12, height: 12 }} /></div>
            <div className="msg-body">
              <div className="msg-head"><span className="msg-name" style={{ color: "var(--olive-text)" }}>metronome</span><span className="msg-time">10:22</span></div>
              <div className="msg-text" style={{ color: "var(--olive-text)" }}>certified: hero section — evidence sha256 4f2a… (click to view diff)</div>
            </div>
          </div>
        </div>
        <div className="channel-input">
          <div className="chan-composer">
            <textarea
              className="chan-composer-input"
              placeholder="message #engineering"
              rows={1}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="chan-composer-toolbar">
              <div className="chan-composer-actions">
                <button className="btn-icon" title="attach file"><Icon name="paperclip" /></button>
                <button className="btn-icon" title="mention"><Icon name="at-sign" /></button>
                <button className="btn-icon" title="emoji"><Icon name="smile" /></button>
              </div>
              <button className={`chan-composer-send${message.trim().length > 0 ? " ready" : ""}`}><Icon name="send" /></button>
            </div>
          </div>
        </div>
      </div>

      <div className={`roster${rosterHidden ? " hide" : ""}`}>
        <div className="roster-head">roster · 4</div>
        <div className="roster-section">active</div>
        <div className="roster-item" onClick={() => setAgentOpen(true)}><div className="avatar avatar-sm av-teal">TH</div><span>tech head</span><span className="roster-role-badge">head</span><div className="roster-dot dot-active" /></div>
        <div className="roster-item" onClick={() => setAgentOpen(true)}><div className="avatar avatar-sm av-terracotta">S1</div><span>scout-1</span><span className="roster-role-badge">scout</span><div className="roster-dot dot-active" /></div>
        <div className="roster-item" onClick={() => setAgentOpen(true)}><div className="avatar avatar-sm av-terracotta">S2</div><span>scout-2</span><span className="roster-role-badge">scout</span><div className="roster-dot dot-active" /></div>
        <div className="roster-section">idle</div>
        <div className="roster-item" onClick={() => setAgentOpen(true)}><div className="avatar avatar-sm av-slate">W3</div><span>worker-3</span><span className="roster-role-badge">worker</span><div className="roster-dot dot-idle" /></div>
      </div>

      <div className={`overlay${agentOpen ? " on" : ""}`} onClick={() => setAgentOpen(false)}>
        <div className="agent-panel" onClick={(event) => event.stopPropagation()}>
          <div className="agent-panel-head">agent <Icon name="x" onClick={() => setAgentOpen(false)} style={{ cursor: "pointer" }} /></div>
          <div className="agent-panel-body">
            <div className="agent-panel-id">
              <div className="avatar avatar-lg av-terracotta">S1</div>
              <div>
                <div className="agent-panel-name">scout-1</div>
                <div className="agent-panel-role">execution worker · engineering</div>
              </div>
            </div>

            <div className="agent-section-label">current mission</div>
            <div className="agent-mission">
              hero section rebuild
              <div className="agent-mission-sub">worktree: .worktrees/hero-section</div>
            </div>

            <div className="agent-section-label">mission bundle scope</div>
            <div className="scope-row"><Icon name="eye" /> read: /repo/marketing</div>
            <div className="scope-row"><Icon name="pencil" /> write: /repo/marketing/hero</div>
            <div className="scope-row scope-deny"><Icon name="wifi-off" /> network: denied</div>

            <div className="agent-section-label">activity</div>
            <div className="activity-row"><span className="t">10:06</span> worktree created</div>
            <div className="activity-row"><span className="t">10:14</span> wrote 3 files</div>
            <div className="activity-row" style={{ color: "var(--olive-text)" }}><span className="t">10:22</span> evidence bundle certified</div>

            <div className="agent-section-label">evidence bundle</div>
            <div className="agent-evidence-link" onClick={() => onNavigate("git")}>
              <Icon name="git-branch" /> view diff &amp; logs <Icon name="chevron-right" className="chev" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
