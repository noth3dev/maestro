import { useState } from "react";
import { Icon } from "../icons.js";

type Tab = "active" | "candidates" | "council" | "negative";

export function Arrangements() {
  const [tab, setTab] = useState<Tab>("active");

  const tabItem = (id: Tab, label: string) => (
    <div className={`page-tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="dash-head" style={{ padding: "14px 20px 0" }}><div className="dash-title">arrangements</div></div>
      <div className="dash-sub" style={{ padding: "0 20px" }}>system self-improvement · certified, lineage-aware changes only</div>
      <div className="page-tabs">
        {tabItem("active", "active")}
        {tabItem("candidates", "candidates")}
        {tabItem("council", "encore council")}
        {tabItem("negative", "negative evidence")}
      </div>

      {tab === "active" && (
        <div className="page-body">
          <div className="arr-item">
            <div className="arr-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="check" /></div>
            <div className="arr-body">
              <div className="arr-title">shorten department-plan briefs by 30%</div>
              <div className="arr-meta">applied · scope: all goals · capability axis</div>
              <div className="arr-deltas"><span>Δquality +2%</span><span>Δcost -18%</span></div>
            </div>
          </div>
          <div className="arr-item">
            <div className="arr-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="check" /></div>
            <div className="arr-body">
              <div className="arr-title">default to flashmob for docs-only tasks</div>
              <div className="arr-meta">applied · scope: goalClass=docs · personalization axis</div>
              <div className="arr-deltas"><span>ΔuserFit +12%</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === "candidates" && (
        <div className="page-body">
          <div className="arr-item">
            <div className="arr-icon" style={{ background: "var(--ochre-bg)", color: "var(--ochre-text)" }}><Icon name="clock" /></div>
            <div className="arr-body">
              <div className="arr-title">route security-sensitive tasks through extra council round</div>
              <div className="arr-meta">shadow replay in progress · parent: none (root)</div>
            </div>
          </div>
        </div>
      )}

      {tab === "council" && (
        <div className="page-body">
          <div className="dash-sub" style={{ padding: "0 0 12px" }}>deliberating: "route security-sensitive tasks through extra council round"</div>

          <div className="msg">
            <div className="avatar avatar-sm av-violet">M</div>
            <div className="msg-body">
              <div className="msg-head"><span className="msg-name">metronome</span><span className="msg-time">shadow replay</span></div>
              <div className="msg-text">replay set: 42 historical security-class goals. quality delta +4%, latency delta +9%.</div>
            </div>
          </div>
          <div className="msg">
            <div className="avatar avatar-sm av-violet">EC</div>
            <div className="msg-body">
              <div className="msg-head"><span className="msg-name">encore council · seat 1</span></div>
              <div className="msg-text">latency cost acceptable given the quality gain. no conflict with currently applied arrangements in this scope.</div>
            </div>
          </div>
          <div className="msg">
            <div className="avatar avatar-sm av-violet">EC</div>
            <div className="msg-body">
              <div className="msg-head"><span className="msg-name">encore council · seat 2</span></div>
              <div className="msg-text">checked against negative evidence — no semantic match to prior rejections. no objection.</div>
            </div>
          </div>
          <div className="alert alert-success" style={{ marginTop: 4 }}>
            <Icon name="circle-check" /><span>convergence reached after 1 round · proceeding to certification</span>
          </div>
        </div>
      )}

      {tab === "negative" && (
        <div className="page-body">
          <div className="arr-item">
            <div className="arr-icon" style={{ background: "var(--rust-bg)", color: "var(--rust-text)" }}><Icon name="x" /></div>
            <div className="arr-body">
              <div className="arr-title">auto-approve sub-$5 spend without conductor review</div>
              <div className="arr-meta">rejected · certification denied, spend velocity anomaly in replay</div>
              <div className="arr-deltas"><span className="neg">vetoes future similar proposals</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
