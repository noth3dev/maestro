import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useT } from "../i18n/index.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { summarizeDashboard } from "../lib/dashboard-data.js";
import type { ViewName } from "../views.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Dashboard({ onNavigate: _onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const t = useT();
  const { config } = useConnection();
  const { goals, selectedGoalId, selectGoal } = useGoals();
  const { detail, loading, error } = useGoalDetail();
  const summary = summarizeDashboard(goals, detail);

  if (config === undefined) return <EmptyState />;

  return (
    <div className="dash-main">
      <div className="dash-head">
        <div className="dash-title">{summary.selectedGoal === undefined ? "no Goal selected" : summary.selectedGoal.goalId}</div>
        {summary.selectedGoal !== undefined && <span className="dash-status">{summary.selectedGoal.state}</span>}
      </div>
      <div className="dash-sub">
        {loading && t.common.loading}
        {error !== undefined && `Could not load Goal state: ${error}`}
        {!loading && error === undefined && summary.selectedGoal !== undefined && `durable version ${summary.selectedGoal.version}`}
      </div>

      <div className="dash-stats">
        <div className="stat-card stat-terracotta"><p className="stat-label">Goals in this project</p><p className="stat-value">{summary.totalGoals}</p></div>
        <div className="stat-card stat-olive"><p className="stat-label">certified (selected Goal)</p><p className="stat-value">{summary.selectedGoal?.certifiedCount ?? "—"}</p></div>
        <div className="stat-card stat-ochre"><p className="stat-label">reserved / budget</p><p className="stat-value">{summary.selectedGoal === undefined ? "—" : `${formatCents(summary.selectedGoal.reservedCents)} / ${formatCents(summary.selectedGoal.budgetCents)}`}</p></div>
        <div className="stat-card stat-rust"><p className="stat-label">actual spend</p><p className="stat-value">{summary.selectedGoal === undefined ? "—" : formatCents(summary.selectedGoal.costCents)}</p></div>
      </div>

      <div className="dash-section-title">goals</div>
      <div className="dept-grid">
        {(goals ?? []).length === 0 ? (
          <p>No durable Goals exist for this project yet.</p>
        ) : (
          (goals ?? []).map((goal) => (
            <div
              key={goal.goalId}
              className={`dept-card ${goal.goalId === selectedGoalId ? "awake" : "asleep"}`}
              onClick={() => selectGoal(goal.goalId)}
              role="button"
              tabIndex={0}
            >
              <div className="dept-card-head"><Icon name="target" /><span className="dept-card-name">{goal.goalId}</span></div>
              <div className={`dept-card-state${goal.goalId === selectedGoalId ? " on" : ""}`}>{goal.state} · v{goal.version}</div>
            </div>
          ))
        )}
      </div>

      <div className="dash-section-title">pipeline</div>
      <EmptyState
        title="Council, Plan, and Mission Bundle state aren't wired here yet"
        hint="The durable data exists in the control plane, but this screen doesn't read it yet. Only real Goal, budget, and certification counts above are live."
      />
    </div>
  );
}
