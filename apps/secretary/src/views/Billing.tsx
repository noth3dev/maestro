import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Billing() {
  const { config } = useConnection();
  const { detail, loading, error } = useGoalDetail();

  if (config === undefined) return <EmptyState />;

  const budget = detail?.budget;
  const remainingCents = budget === undefined ? undefined : budget.budgetCents - budget.reservedCents;
  const usedPct = budget === undefined || budget.budgetCents <= 0 ? undefined : Math.min(100, Math.round((budget.reservedCents / budget.budgetCents) * 100));

  return (
    <div className="dash-main">
      <div className="dash-head"><div className="dash-title">billing</div></div>
      <div className="dash-sub">budget for the selected Goal · cross-Goal treasury rollups not wired yet</div>

      {loading && <p>loading…</p>}
      {error !== undefined && <div className="alert alert-warning">{error}</div>}

      {budget !== undefined && (
        <>
          <div className="dash-stats">
            <div className="stat-card stat-terracotta"><p className="stat-label">actual spend</p><p className="stat-value">{formatCents(budget.costCents)}</p></div>
            <div className="stat-card stat-ochre"><p className="stat-label">ceiling</p><p className="stat-value">{formatCents(budget.budgetCents)}</p></div>
            <div className="stat-card stat-olive"><p className="stat-label">reserved</p><p className="stat-value">{formatCents(budget.reservedCents)}</p></div>
            <div className="stat-card stat-rust"><p className="stat-label">remaining</p><p className="stat-value">{remainingCents === undefined ? "—" : formatCents(remainingCents)}</p></div>
          </div>

          {usedPct !== undefined && (
            <div className="progress-wrap" style={{ marginBottom: 24 }}>
              <div className="progress-label"><span>reserved of ceiling</span><span>{formatCents(budget.reservedCents)} / {formatCents(budget.budgetCents)} · {usedPct}%</span></div>
              <div className="progress"><div className="progress-bar ochre" style={{ width: `${usedPct}%` }} /></div>
            </div>
          )}
        </>
      )}

      {detail === undefined && !loading && error === undefined && (
        <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to see its real budget here." />
      )}

      <div className="dash-section-title" style={{ marginTop: 20 }}>daily spend, usage by group, and cross-Goal totals</div>
      <EmptyState
        title="Not wired here yet"
        hint="Only the selected Goal's real ceiling/reserved/spend numbers above are live. A daily spend history, per-department breakdown, and cross-Goal rollup would each need their own durable read surface, which doesn't exist yet."
      />
    </div>
  );
}
