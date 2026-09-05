import { Icon } from "../icons.js";

const spendByDay = [22, 38, 14, 55, 31, 8, 12, 64, 47, 29, 71, 40, 59, 83];

const usageByGroup = [
  { icon: "code", name: "tech", pct: 53, amount: "$98" },
  { icon: "clipboard-check", name: "assurance", pct: 22, amount: "$41" },
  { icon: "package", name: "product", pct: 17, amount: "$32" },
  { icon: "settings", name: "operations", pct: 8, amount: "$15" },
  { icon: "flask-conical", name: "intelligence", pct: 0, amount: "$0" },
];

const recentGoals = [
  { name: "launch page", amount: "$61.40" },
  { name: "billing refactor", amount: "$79.10" },
  { name: "docs cleanup", amount: "$45.90" },
];

export function Billing() {
  return (
    <div className="dash-main">
      <div className="dash-head"><div className="dash-title">billing</div></div>
      <div className="dash-sub">token &amp; compute usage · treasury not yet wired (phase 10)</div>

      <div className="dash-stats">
        <div className="stat-card stat-terracotta"><p className="stat-label">used this month</p><p className="stat-value">$186</p></div>
        <div className="stat-card stat-ochre"><p className="stat-label">ceiling</p><p className="stat-value">$300</p></div>
        <div className="stat-card stat-olive"><p className="stat-label">avg / goal</p><p className="stat-value">$14.20</p></div>
        <div className="stat-card stat-rust"><p className="stat-label">days left in cycle</p><p className="stat-value">9</p></div>
      </div>

      <div className="progress-wrap" style={{ marginBottom: 24 }}>
        <div className="progress-label"><span>monthly ceiling</span><span>$186 / $300 · 62%</span></div>
        <div className="progress"><div className="progress-bar ochre" style={{ width: "62%" }} /></div>
      </div>

      <div className="dash-section-title">daily spend · last 14 days</div>
      <div className="spend-chart">
        {spendByDay.map((height, index) => (
          <div key={index} className="spend-bar-wrap">
            <div className={`spend-bar${index === spendByDay.length - 1 ? " today" : ""}`} style={{ height: `${height}%` }} />
            <span className="spend-bar-day">{index + 1}</span>
          </div>
        ))}
      </div>

      <div className="dash-section-title" style={{ marginTop: 20 }}>usage by group</div>
      {usageByGroup.map((group) => (
        <div key={group.name} className="dept-bar-row">
          <Icon name={group.icon} /><span className="dept-bar-name">{group.name}</span>
          <div className="dept-bar-track"><div className="dept-bar-fill" style={{ width: `${group.pct}%` }} /></div>
          <span className="dept-bar-amt">{group.amount}</span>
        </div>
      ))}

      <div className="dash-section-title" style={{ marginTop: 20 }}>recent goals</div>
      <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        {recentGoals.map((goal, index) => (
          <div key={goal.name} style={{ padding: "11px 14px", borderBottom: index < recentGoals.length - 1 ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 12 }}>{goal.name}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-secondary)" }}>{goal.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
