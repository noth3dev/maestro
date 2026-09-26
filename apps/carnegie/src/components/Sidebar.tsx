import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons.js";
import { useT } from "../i18n/index.js";
import { useTheme } from "../theme.js";
import { useGoals } from "../goals.js";
import { useConnection } from "../connection.js";
import { useSessions } from "../sessions.js";
import { projectName, useProjects } from "../projects.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import { loadPendingApprovalCount } from "../lib/inbox-data.js";
import type { ViewName } from "../views.js";

export function Sidebar({ view, onNavigate }: { view: ViewName; onNavigate: (view: ViewName) => void }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const { goals, orchestrationByGoalId = {}, selectedGoalId, selectGoal } = useGoals();
  const { config } = useConnection();
  const { projects, projectId, homeProjectId } = useProjects();
  const { sessions, activeConversationId, openSession } = useSessions();
  const [collapsed, setCollapsed] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState<number | undefined>(undefined);

  const refreshInboxCount = useCallback(() => {
    if (config === undefined) { setPendingApprovalCount(undefined); return; }
    let cancelled = false;
    // The inbox is global: approvals from every project.
    const projectIds = projects?.map((project) => project.projectId) ?? [config.projectId];
    void Promise.all(projectIds.map((id) => loadPendingApprovalCount(window.maestro.api, id).catch(() => 0)))
      .then((counts) => { if (!cancelled) setPendingApprovalCount(counts.reduce((sum, count) => sum + count, 0)); })
      .catch(() => { if (!cancelled) setPendingApprovalCount(undefined); });
    return () => { cancelled = true; };
  }, [config, projects]);

  useEffect(() => {
    let cancel = refreshInboxCount();
    const onInboxUpdated = () => { cancel?.(); cancel = refreshInboxCount(); };
    window.addEventListener("maestro:inbox-updated", onInboxUpdated);
    return () => { cancel?.(); window.removeEventListener("maestro:inbox-updated", onInboxUpdated); };
  }, [refreshInboxCount]);

  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const selectedGoal = goals?.find((goal) => goal.goalId === selectedGoalId);

  const navItem = (name: ViewName, icon: string, label: string, count?: number) => (
    <button type="button" className={`sb-item${view === name ? " on" : ""}`} aria-current={view === name ? "page" : undefined} onClick={() => onNavigate(name)}>
      <Icon name={icon} /> <span className="lbl">{label}</span>
      {count !== undefined && <span className="sb-count">{count}</span>}
    </button>
  );

  return (
    <nav className={`sidebar${collapsed ? " collapsed" : ""}`} aria-label="Primary navigation">
      <div className="sb-logo">
        <div className="sb-logo-mark" />
        <div className="sb-logo-text">maestro</div>
        <button
          type="button"
          className="sb-collapse-btn"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((current) => !current)}
        >
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} />
        </button>
      </div>

      <div className="sb-scroll">
        <div className="sb-menu">
          <button
            type="button"
            className={`sb-item${view === "home" && activeConversationId === undefined ? " on" : ""}`}
            aria-current={view === "home" && activeConversationId === undefined ? "page" : undefined}
            onClick={() => { openSession(undefined); onNavigate("home"); }}
          >
            <Icon name="message-square-text" /> <span className="lbl">{t.nav.concertmaster}</span>
            <Icon name="plus" className="sb-item-trailing" aria-hidden="true" />
          </button>
          {sessions !== undefined && sessions.length > 0 && (
            <div className="sb-sessions" role="list" aria-label="Concertmaster sessions">
              {sessions.map((session) => {
                const active = view === "home" && session.conversationId === activeConversationId;
                return (
                  <button
                    key={session.conversationId}
                    type="button"
                    role="listitem"
                    className={`sb-session${active ? " on" : ""}`}
                    aria-current={active ? "page" : undefined}
                    title={session.title ?? t.nav.untitledSession}
                    onClick={() => { openSession(session.conversationId); onNavigate("home"); }}
                  >
                    <span className="lbl">{session.title ?? t.nav.untitledSession}</span>
                    {session.projectId !== homeProjectId && <span className="sb-session-project">{projectName(projects, session.projectId)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {navItem("inbox", "inbox", t.nav.inbox, pendingApprovalCount)}
          {navItem("billing", "credit-card", t.nav.billing)}
        </div>

        <div className="sb-project" role="group" aria-label={`Project ${projectName(projects, projectId)}`}>
          <div className="sb-project-head" aria-hidden="true">
            <span className="lbl">{projectName(projects, projectId)}</span>
          </div>
          <div className="sb-menu">
            {navItem("dashboard", "layout-dashboard", t.nav.dashboard)}
            {navItem("kanban", "square-kanban", t.nav.kanban)}
            {navItem("planning", "clipboard-list", t.nav.planning)}
            {navItem("channel", "message-circle", "channel")}
            {navItem("flashmob", "zap", t.nav.flashmob)}
          </div>
          <div className="sb-fixed-menu-group" />
          <div className="sb-menu">
            {navItem("evlog", "shield-check", t.nav.evidenceLog)}
            {navItem("persona", "user-round", "persona")}
            {navItem("luthiery", "hammer", t.nav.luthiery)}
            {navItem("arrangements", "git-merge", t.nav.arrangements)}
          </div>

          <div className="sb-goalswitch" role="heading" aria-level={2}>
            <span className="lbl">goals{selectedGoal !== undefined ? ` · ${selectedGoal.state}` : ""}</span>
          </div>
          {goals !== undefined && goals.length > 0 && (
            <div className="sb-channels">
              {goals.map((goal) => (
                <button key={goal.goalId} type="button" className={`sb-chan${goal.goalId === selectedGoalId ? " on" : ""}`} onClick={() => selectGoal(goal.goalId)} aria-label={`Goal ${goal.goalId.slice(0, 8)}`}>
                  <Icon name="crown" /> <span className="lbl">{goal.goalId.slice(0, 8)}</span>
                  {orchestrationByGoalId[goal.goalId] !== undefined && <span className="sb-goal-status" data-orchestration-stage={orchestrationByGoalId[goal.goalId]!.stage}>{orchestrationByGoalId[goal.goalId]!.stage}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ProjectSwitcher />
      <div className="sb-bottom">
        <div className="avatar avatar-sm av-slate">U</div>
        <span>operator</span>
        <div className="sb-bottom-icons">
          <button
            type="button"
            className="btn-icon"
            aria-label={isDark ? "Use light theme" : "Use dark theme"}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            <Icon name={isDark ? "sun" : "moon"} />
          </button>
        </div>
      </div>
    </nav>
  );
}
