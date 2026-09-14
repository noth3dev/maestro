import { useState } from "react";
import { Icon } from "../icons.js";
import { useT } from "../i18n/index.js";
import { useTheme } from "../theme.js";
import { useGoals } from "../goals.js";
import type { ViewName } from "../views.js";

export function Sidebar({ view, onNavigate }: { view: ViewName; onNavigate: (view: ViewName) => void }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const { goals, selectedGoalId, selectGoal } = useGoals();
  const [collapsed, setCollapsed] = useState(false);

  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const selectedGoal = goals?.find((goal) => goal.goalId === selectedGoalId);

  const navItem = (name: ViewName, icon: string, label: string, count?: number) => (
    <button type="button" className={`sb-item${view === name ? " on" : ""}`} onClick={() => onNavigate(name)}>
      <Icon name={icon} /> <span className="lbl">{label}</span>
      {count !== undefined && <span className="sb-count">{count}</span>}
    </button>
  );

  return (
    <div className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sb-logo">
        <div className="sb-logo-mark" />
        <div className="sb-logo-text">maestro</div>
        <button type="button" className="sb-collapse-btn" onClick={() => setCollapsed((current) => !current)}>
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} />
        </button>
      </div>

      <div className="sb-scroll">
        <div className="sb-menu">
          {navItem("home", "search", t.nav.search)}
          {navItem("inbox", "inbox", t.nav.inbox)}
          {navItem("dashboard", "layout-dashboard", t.nav.dashboard)}
          {navItem("flashmob", "zap", t.nav.flashmob)}
        </div>
        <div className="sb-fixed-menu-group" />
        <div className="sb-menu">
          {navItem("floor", "chart-pie", t.nav.floor)}
          {navItem("evlog", "shield-check", t.nav.evidenceLog)}
          {navItem("billing", "credit-card", t.nav.billing)}
        </div>
        <div className="sb-fixed-menu-group" />
        <div className="sb-menu">
          {navItem("luthiery", "hammer", t.nav.luthiery)}
          {navItem("arrangements", "git-merge", t.nav.arrangements)}
        </div>
        <div className="sb-divider" />

        <button type="button" className="sb-goalswitch">
          <span className="lbl">{selectedGoal !== undefined ? selectedGoal.state : "—"}</span> <Icon name="chevron-down" />
        </button>
        {goals !== undefined && goals.length > 0 && (
          <div className="sb-channels">
            {goals.map((goal) => (
              <button key={goal.goalId} type="button" className={`sb-chan${goal.goalId === selectedGoalId ? " on" : ""}`} onClick={() => selectGoal(goal.goalId)}>
                <Icon name="crown" /> <span className="lbl">{goal.goalId.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sb-bottom">
        <div className="avatar avatar-sm av-slate">U</div>
        <span>operator</span>
        <div className="sb-bottom-icons">
          <button type="button" className="btn-icon" onClick={() => setTheme(isDark ? "light" : "dark")}>
            <Icon name={isDark ? "sun" : "moon"} />
          </button>
          <button type="button" className="btn-icon" onClick={() => onNavigate("settings")}>
            <Icon name="settings" />
          </button>
        </div>
      </div>
    </div>
  );
}
