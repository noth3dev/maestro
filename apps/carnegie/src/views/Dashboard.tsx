import { useEffect, useState } from "react";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useT } from "../i18n/index.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { useGoalWorkers } from "../useGoalWorkers.js";
import { summarizeDashboard } from "../lib/dashboard-data.js";
import { runGoalControlAction, type GoalControlAction } from "../lib/goal-control.js";
import type { ViewName } from "../views.js";
import type { DurableEventState } from "../useDurableEvents.js";
import type { ConcertmasterFinalReport, EncoreCouncilRoundList, MetronomeChallenge } from "@maestro/api-client";
import { durableReadRefreshToken } from "../lib/durable-refresh.js";
import { useGoalEvidenceBundle } from "../useGoalEvidenceBundle.js";
import { useGoalProjection } from "./panels/useGoalProjection.js";
import { GoalDepartmentPanels } from "./panels/GoalDepartmentPanels.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const CONTROL_ACTIONS: { action: GoalControlAction; label: string }[] = [
  { action: "pause", label: "Pause" },
  { action: "resume", label: "Resume" },
  { action: "stop", label: "Stop" },
  { action: "emergency-stop", label: "Emergency stop" },
];

export function Dashboard({ onNavigate: _onNavigate, eventState }: { onNavigate: (view: ViewName) => void; eventState: DurableEventState }) {
  const t = useT();
  const { config } = useConnection();
  const { goals, selectedGoalId, selectGoal } = useGoals();
  const durableRefreshToken = durableReadRefreshToken(eventState.cursor);
  const { detail, loading, error, refresh } = useGoalDetail(durableRefreshToken);
  const { workers, loading: workersLoading, error: workersError } = useGoalWorkers(durableRefreshToken);
  const { evidenceBundle, error: evidenceError } = useGoalEvidenceBundle(durableRefreshToken);
  const projectionState = useGoalProjection(config === undefined ? undefined : window.maestro.api, config?.projectId, selectedGoalId, eventState.cursor);
  const [metronomeChallenges, setMetronomeChallenges] = useState<readonly MetronomeChallenge[] | undefined>(undefined);
  const [encoreRounds, setEncoreRounds] = useState<EncoreCouncilRoundList["rounds"] | undefined>(undefined);
  const [report, setReport] = useState<ConcertmasterFinalReport | undefined>(undefined);
  useEffect(() => {
    setMetronomeChallenges(undefined);
    setEncoreRounds(undefined);
    setReport(undefined);
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    void Promise.allSettled([
      window.maestro.api.listMetronomeChallenges(selectedGoalId, { projectId: config.projectId }),
      window.maestro.api.listEncoreCouncilRounds(selectedGoalId, { projectId: config.projectId }),
      window.maestro.api.getConcertmasterReport(selectedGoalId, { projectId: config.projectId }),
    ]).then(([metronome, encore, finalReport]) => {
      if (cancelled) return;
      setMetronomeChallenges(metronome.status === "fulfilled" ? metronome.value.challenges : undefined);
      setEncoreRounds(encore.status === "fulfilled" ? encore.value.rounds : undefined);
      setReport(finalReport.status === "fulfilled" ? finalReport.value : undefined);
    });
    return () => { cancelled = true; };
  }, [config, selectedGoalId, durableRefreshToken]);
  const summary = summarizeDashboard(goals, detail);
  const [controlError, setControlError] = useState<string | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<GoalControlAction | undefined>(undefined);

  if (config === undefined) return <EmptyState />;

  const runControl = async (action: GoalControlAction) => {
    if (summary.selectedGoal === undefined) return;
    setControlError(undefined);
    setPendingAction(action);
    try {
      await runGoalControlAction(window.maestro.api, {
        goalId: summary.selectedGoal.goalId,
        projectId: config.projectId,
        action,
        expectedVersion: summary.selectedGoal.version,
      });
      refresh();
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "Could not run that Goal control");
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <main className="dash-main">
      <header className="dash-head">
        <div>
          <div className="dash-kicker">Goal overview</div>
          <h1 className="dash-title">{summary.selectedGoal === undefined ? "No Goal selected" : summary.selectedGoal.goalId}</h1>
        </div>
        {summary.selectedGoal !== undefined && <span className="dash-status">{summary.selectedGoal.state}</span>}
      </header>
      <div className="dash-sub" role="status">
        {loading && t.common.loading}
        {!loading && error === undefined && summary.selectedGoal !== undefined && `Durable version ${summary.selectedGoal.version}`}
      </div>
      {error !== undefined && (
        <div className="dash-inline-alert alert alert-warning" role="alert">
          <div>
            <strong>Goal state is unavailable</strong>
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => refresh()}>Retry</button>
        </div>
      )}

      <section className="dash-stats" aria-label="Goal summary">
        <div className="stat-card stat-terracotta"><p className="stat-label">Goals in this project</p><p className="stat-value">{summary.totalGoals}</p></div>
        <div className="stat-card stat-olive"><p className="stat-label">Certified</p><p className="stat-value">{summary.selectedGoal?.certifiedCount ?? "—"}</p></div>
        <div className="stat-card stat-ochre"><p className="stat-label">Reserved / budget</p><p className="stat-value">{summary.selectedGoal === undefined ? "—" : `${formatCents(summary.selectedGoal.reservedCents)} / ${formatCents(summary.selectedGoal.budgetCents)}`}</p></div>
        <div className="stat-card stat-rust"><p className="stat-label">Actual spend</p><p className="stat-value">{summary.selectedGoal === undefined ? "—" : formatCents(summary.selectedGoal.costCents)}</p></div>
      </section>

      {summary.selectedGoal !== undefined && (
        <section className="dash-controls" aria-labelledby="lifecycle-title">
          <div className="dash-section-heading">
            <div>
              <h2 id="lifecycle-title" className="dash-section-title">Lifecycle controls</h2>
              <p className="dash-section-hint">Actions apply to durable version {summary.selectedGoal.version}. Stale changes are rejected safely.</p>
            </div>
          </div>
          {controlError !== undefined && <div className="alert alert-warning" role="alert">{controlError}</div>}
          <div className="dash-control-group" role="group" aria-label="Goal lifecycle controls">
            {CONTROL_ACTIONS.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                className={`btn dash-control${action === "emergency-stop" ? " dash-control-danger" : ""}`}
                disabled={pendingAction !== undefined}
                onClick={() => void runControl(action)}
              >
                {pendingAction === action ? t.common.loading : label}
              </button>
            ))}
          </div>
        </section>
      )}

      <h2 className="dash-section-title">Goals</h2>
      <div className="dept-grid" aria-label="Goals in this project">
        {(goals ?? []).length === 0 ? (
          <p className="dash-empty">No durable Goals exist for this project yet.</p>
        ) : (
          (goals ?? []).map((goal) => (
            <button
              key={goal.goalId}
              type="button"
              className={`dept-card ${goal.goalId === selectedGoalId ? "awake" : "asleep"}`}
              onClick={() => selectGoal(goal.goalId)}
              aria-pressed={goal.goalId === selectedGoalId}
            >
              <span className="dept-card-head"><Icon name="target" /><span className="dept-card-name">{goal.goalId}</span></span>
              <span className={`dept-card-state${goal.goalId === selectedGoalId ? " on" : ""}`}>{goal.state} · v{goal.version}</span>
            </button>
          ))
        )}
      </div>

      <h2 className="dash-section-title">Pipeline</h2>
      {workersLoading && <p className="dash-loading" role="status">Loading workers…</p>}
      {workersError !== undefined && <div className="alert alert-warning" role="alert">{workersError}</div>}
      {!workersLoading && workersError === undefined && workers !== undefined && workers.length === 0 && (
        <EmptyState title="No workers yet" hint="No worker has been spawned for this Goal yet." />
      )}
      {workers !== undefined && workers.length > 0 && (
        <div className="kanban">
          {(["spawned", "running", "succeeded", "failed", "cancelled", "unknown"] as const).map((status) => {
            const columnWorkers = workers.filter((worker) => worker.status === status);
            if (columnWorkers.length === 0) return null;
            return (
              <div key={status}>
                <div className="kanban-col-head">{status} <span className="n">{columnWorkers.length}</span></div>
                <div className="kanban-col">
                  {columnWorkers.map((worker) => (
                    <div key={worker.workerId} className="kcard">
                      <div className="kcard-title">{worker.itemId}</div>
                      <div className="kcard-meta">
                        <div className="kcard-dept"><Icon name="code" /> {worker.departmentId}</div>
                        <span className="badge kcard-badge">attempt {worker.attempt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <h2 className="dash-section-title dash-section-title-office">Goal office detail</h2>
      {projectionState.loading && <p className="dash-loading" role="status">Loading Goal office…</p>}
      {projectionState.error !== undefined && (
        <div className="dash-detail-alert alert alert-warning" role="alert">
          <div><strong>Goal office detail is unavailable</strong><span>{projectionState.error}</span></div>
        </div>
      )}
      {evidenceError !== undefined && (
        <div className="dash-detail-alert alert alert-warning" role="alert">
          <div><strong>Evidence is unavailable</strong><span>{evidenceError}</span></div>
        </div>
      )}
      {projectionState.projection !== undefined && (
        <GoalDepartmentPanels
          projection={projectionState.projection}
          events={eventState.events}
          budget={detail?.budget}
          certifications={detail?.certifications ?? []}
          evidenceBundle={evidenceBundle}
          metronomeChallenges={metronomeChallenges}
          encoreRounds={encoreRounds}
          report={report}
          goalId={selectedGoalId}
        />
      )}
    </main>
  );
}
