import React, { useEffect, useState } from "react";
import type { BillingReadModel } from "@maestro/api-client";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Billing() {
  const { config } = useConnection();
  const { detail, loading, error } = useGoalDetail();
  const [billing, setBilling] = useState<BillingReadModel | undefined>(undefined);
  const [billingError, setBillingError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined) {
      setBilling(undefined);
      return;
    }
    let cancelled = false;
    setBilling(undefined);
    setBillingError(undefined);
    void window.maestro.api.getBillingSummary(config.projectId)
      .then((loaded) => { if (!cancelled) setBilling(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setBillingError(cause instanceof Error ? cause.message : "Could not load billing history"); });
    return () => { cancelled = true; };
  }, [config]);

  if (config === undefined) return <EmptyState />;

  const budget = detail?.budget;
  const remainingCents = budget === undefined ? undefined : budget.budgetCents - budget.reservedCents;
  const usedPct = budget === undefined || budget.budgetCents <= 0 ? undefined : Math.min(100, Math.round((budget.reservedCents / budget.budgetCents) * 100));

  return (
    <div className="dash-main">
      <div className="dash-head"><div className="dash-title">billing</div></div>
      <div className="dash-sub">budget for the selected Goal · durable project billing rollup</div>

      {loading && <p>loading…</p>}
      {error !== undefined && <div className="alert alert-warning">{error}</div>}
      {billingError !== undefined && <div className="alert alert-warning">{billingError}</div>}

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

      <div className="dash-section-title" style={{ marginTop: 20 }}>daily spend and cross-Goal totals</div>
      {billing !== undefined && (
        <>
          <div className="dash-panel">
            <div className="dash-panel-head"><span>last 14 days · actual spend</span><strong>{formatCents(billing.totals.costCents)}</strong></div>
            <div className="billing-history" aria-label="Daily actual spend history">
              {billing.dailySpend.map((day) => (
                <div className="billing-day" key={day.date}>
                  <span>{day.date.slice(5)}</span>
                  <div className="billing-day-bar"><div className="progress-bar terracotta" style={{ width: `${billing.totals.costCents === 0 ? 0 : Math.min(100, Math.round((day.costCents / billing.totals.costCents) * 100))}%` }} /></div>
                  <strong>{formatCents(day.costCents)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="dash-panel" style={{ marginTop: 16 }}>
            <div className="dash-panel-head"><span>cross-Goal totals</span><strong>{billing.goals.length} Goals</strong></div>
            <div className="dash-stats">
              <div className="stat-card stat-terracotta"><p className="stat-label">actual spend</p><p className="stat-value">{formatCents(billing.totals.costCents)}</p></div>
              <div className="stat-card stat-ochre"><p className="stat-label">ceiling</p><p className="stat-value">{formatCents(billing.totals.budgetCents)}</p></div>
              <div className="stat-card stat-olive"><p className="stat-label">reserved</p><p className="stat-value">{formatCents(billing.totals.reservedCents)}</p></div>
            </div>
          </div>
        </>
      )}
      <div className="dash-panel" style={{ marginTop: 16 }}>
        <div className="dash-panel-head"><span>per-department cost</span><strong>unavailable</strong></div>
        <p className="muted">{billing?.departmentBreakdown.reason ?? "No durable department breakdown is available."}</p>
      </div>
    </div>
  );
}
