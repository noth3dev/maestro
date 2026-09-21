import { useEffect, useState } from "react";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { ApiErrorNotice } from "../components/ApiErrorNotice.js";
import { ConfirmActionDialog } from "../components/ConfirmActionDialog.js";
import { useT } from "../i18n/index.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { useGoalWorkers, type GoalReadScope } from "../useGoalWorkers.js";
import { summarizeDashboard } from "../lib/dashboard-data.js";
import { requiresGoalControlConfirmation, runGoalControlAction, type GoalControlAction, type GoalControlRequest } from "../lib/goal-control.js";
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
  const { goals, selectedGoalId, selectGoal, refresh: refreshGoals, loadedFor: goalsLoadedFor, loading: goalsLoading, error: goalsError } = useGoals();
  const durableRefreshToken = durableReadRefreshToken(eventState.cursor);
  const { detail, loading, error, loadedFor: detailLoadedFor, errorLoadedFor: detailErrorLoadedFor, refresh } = useGoalDetail(durableRefreshToken);
  const { workers, loading: workersLoading, error: workersError, loadedFor: workersLoadedFor } = useGoalWorkers(durableRefreshToken);
  const { evidenceBundle, error: evidenceError, loadedFor: evidenceLoadedFor } = useGoalEvidenceBundle(durableRefreshToken);
  const projectionState = useGoalProjection(config === undefined ? undefined : window.maestro.api, config?.projectId, selectedGoalId, eventState.cursor);
  const [metronomeChallenges, setMetronomeChallenges] = useState<readonly MetronomeChallenge[] | undefined>(undefined);
  const [encoreRounds, setEncoreRounds] = useState<EncoreCouncilRoundList["rounds"] | undefined>(undefined);
  const [report, setReport] = useState<ConcertmasterFinalReport | undefined>(undefined);
  const [auxiliaryScope, setAuxiliaryScope] = useState<GoalReadScope | undefined>(undefined);
  useEffect(() => {
    setMetronomeChallenges(undefined);
    setEncoreRounds(undefined);
    setReport(undefined);
    setAuxiliaryScope(undefined);
    if (config === undefined || selectedGoalId === undefined) return;
    const scope = { projectId: config.projectId, goalId: selectedGoalId, refreshKey: durableRefreshToken };
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
      setAuxiliaryScope(scope);
    });
    return () => { cancelled = true; };
  }, [config, selectedGoalId, durableRefreshToken]);
  const goalsReady = goals !== undefined
    && !goalsLoading
    && goalsError === undefined
    && config !== undefined
    && goalsLoadedFor?.projectId === config.projectId
    && goalsLoadedFor.refreshKey === durableRefreshToken;
  const currentGoals = goalsReady ? goals : undefined;
  const detailForSelection = goalsReady
    && detail !== undefined
    && detailLoadedFor?.refreshKey === durableRefreshToken
    && config !== undefined
    && selectedGoalId !== undefined
    && goals.some((goal) => goal.goalId === selectedGoalId)
    && selectedGoalId === detail.goal.goalId
    && config.projectId === detail.goal.projectId
    ? detail
    : undefined;
  const scopeMatchesSelection = (scope: GoalReadScope | undefined): boolean =>
    goalsReady
      && scope !== undefined
      && config !== undefined
      && selectedGoalId !== undefined
      && goals.some((goal) => goal.goalId === selectedGoalId)
      && scope.projectId === config.projectId
      && scope.goalId === selectedGoalId
      && scope.refreshKey === durableRefreshToken;
  const currentWorkers = scopeMatchesSelection(workersLoadedFor) ? workers : undefined;
  const currentWorkersError = scopeMatchesSelection(workersLoadedFor) ? workersError : undefined;
  const currentEvidenceBundle = scopeMatchesSelection(evidenceLoadedFor) ? evidenceBundle : undefined;
  const currentEvidenceError = scopeMatchesSelection(evidenceLoadedFor) ? evidenceError : undefined;
  const currentProjection = scopeMatchesSelection(projectionState.loadedFor) ? projectionState.projection : undefined;
  const currentAuxiliary = scopeMatchesSelection(auxiliaryScope);
  const currentDetailError = scopeMatchesSelection(detailErrorLoadedFor) ? error : undefined;
  const summary = summarizeDashboard(currentGoals, detailForSelection);
  const [controlError, setControlError] = useState<unknown>(undefined);
  const [failedRequest, setFailedRequest] = useState<GoalControlRequest | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<GoalControlAction | undefined>(undefined);
  const [confirmationRequest, setConfirmationRequest] = useState<GoalControlRequest | undefined>(undefined);

  if (config === undefined) return <EmptyState />;

  const runControl = async (request: GoalControlRequest): Promise<void> => {
    setControlError(undefined);
    setFailedRequest(undefined);
    setPendingAction(request.action);
    try {
      await runGoalControlAction(window.maestro.api, request);
    } catch (cause) {
      setControlError(cause);
      setFailedRequest(request);
      setPendingAction(undefined);
      return;
    }
    setPendingAction(undefined);
    refresh();
    void refreshGoals();
  };

  const requestControl = (request: GoalControlRequest): void => {
    if (requiresGoalControlConfirmation(request.action)) setConfirmationRequest(request);
    else void runControl(request);
  };

  const requestSelectedControl = (action: GoalControlAction): void => {
    if (summary.selectedGoal === undefined) return;
    requestControl({
      goalId: summary.selectedGoal.goalId,
      projectId: config.projectId,
      action,
      expectedVersion: summary.selectedGoal.version,
    });
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
        {!loading && currentDetailError === undefined && summary.selectedGoal !== undefined && `Durable version ${summary.selectedGoal.version}`}
      </div>
      {currentDetailError !== undefined && (
        <div className="dash-inline-alert alert alert-warning" role="alert">
          <div>
            <strong>Goal state is unavailable</strong>
            <span>{currentDetailError}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => refresh()}>Retry</button>
        </div>
      )}

      {goalsError !== undefined && <ApiErrorNotice error={goalsError} onRetry={() => void refreshGoals()} />}

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
          {controlError !== undefined && (
            <ApiErrorNotice
              error={controlError}
              {...(failedRequest === undefined ? {} : { onRetry: () => requestControl(failedRequest) })}
            />
          )}
          <div className="dash-control-group" role="group" aria-label="Goal lifecycle controls">
            {CONTROL_ACTIONS.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                className={`btn dash-control${action === "emergency-stop" ? " dash-control-danger" : ""}`}
                disabled={pendingAction !== undefined}
                onClick={() => requestSelectedControl(action)}
              >
                {pendingAction === action ? t.common.loading : label}
              </button>
            ))}
          </div>
          <ConfirmActionDialog
            open={confirmationRequest !== undefined}
            title={confirmationRequest?.action === "emergency-stop" ? "Emergency-stop this Goal?" : "Stop this Goal?"}
            effectSummary={confirmationRequest === undefined ? "" : `This sends a durable ${confirmationRequest.action === "emergency-stop" ? "emergency-stop" : "stop"} command for ${confirmationRequest.goalId} at version ${confirmationRequest.expectedVersion}.`}
            confirmLabel={confirmationRequest?.action === "emergency-stop" ? "Emergency stop" : "Stop Goal"}
            danger
            onCancel={() => setConfirmationRequest(undefined)}
            onConfirm={() => {
              const request = confirmationRequest;
              setConfirmationRequest(undefined);
              if (request !== undefined) void runControl(request);
            }}
          />
        </section>
      )}

      <h2 className="dash-section-title">Goals</h2>
      {goalsLoading && <p className="dash-loading" role="status">Loading Goals…</p>}
      <div className="dept-grid" aria-label="Goals in this project">
        {(currentGoals ?? []).length === 0 ? (
          <p className="dash-empty">No durable Goals exist for this project yet.</p>
        ) : (
          (currentGoals ?? []).map((goal) => (
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
      {currentWorkersError !== undefined && <div className="alert alert-warning" role="alert">{currentWorkersError}</div>}
      {!workersLoading && currentWorkersError === undefined && currentWorkers !== undefined && currentWorkers.length === 0 && (
        <EmptyState title="No workers yet" hint="No worker has been spawned for this Goal yet." />
      )}
      {currentWorkers !== undefined && currentWorkers.length > 0 && (
        <div className="kanban">
          {(["spawned", "running", "succeeded", "failed", "cancelled", "unknown"] as const).map((status) => {
            const columnWorkers = currentWorkers.filter((worker) => worker.status === status);
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
      {scopeMatchesSelection(projectionState.loadedFor) && projectionState.error !== undefined && (
        <div className="dash-detail-alert alert alert-warning" role="alert">
          <div><strong>Goal office detail is unavailable</strong><span>{projectionState.error}</span></div>
        </div>
      )}
      {currentEvidenceError !== undefined && (
        <div className="dash-detail-alert alert alert-warning" role="alert">
          <div><strong>Evidence is unavailable</strong><span>{currentEvidenceError}</span></div>
        </div>
      )}
      {currentProjection !== undefined && (
        <GoalDepartmentPanels
          projection={currentProjection}
          events={eventState.events}
          budget={detailForSelection?.budget}
          certifications={detailForSelection?.certifications ?? []}
          evidenceBundle={currentEvidenceBundle}
          metronomeChallenges={currentAuxiliary ? metronomeChallenges : undefined}
          encoreRounds={currentAuxiliary ? encoreRounds : undefined}
          report={currentAuxiliary ? report : undefined}
          goalId={selectedGoalId}
        />
      )}
    </main>
  );
}
