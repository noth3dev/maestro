import React, { useEffect, useRef, useState } from "react";
import type { BillingReadModel, GoalBudgetSummary } from "@maestro/api-client";
import { EmptyState } from "../components/EmptyState.js";
import { isSessionFailure, useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { formatCents, safeErrorMessage } from "../lib/settings-data.js";

export function BillingStateNotice({
  goalSelected,
  budgetLoading,
  budgetError,
  budgetStale,
  budget,
  billing,
  billingLoading,
  billingError,
  billingStale,
}: {
  goalSelected: boolean;
  budgetLoading: boolean;
  budgetError: string | undefined;
  budgetStale: boolean;
  budget: GoalBudgetSummary | undefined;
  billing: BillingReadModel | undefined;
  billingLoading: boolean;
  billingError: string | undefined;
  billingStale: boolean;
}) {
  return (
    <>
      {budgetLoading && <p role="status" aria-busy="true">loading Goal budget…</p>}
      {budgetError !== undefined && <div className="alert alert-warning" role="alert">{budgetError}</div>}
      {budgetStale && budget !== undefined && <div className="alert alert-warning" role="status">Showing the last saved budget; refresh failed.</div>}
      {billingError !== undefined && <div className="alert alert-warning" role="alert">{billingError}</div>}
      {billingStale && billing !== undefined && <div className="alert alert-warning" role="status">Showing the last saved billing record; refresh failed.</div>}
      {!goalSelected && !budgetLoading && budgetError === undefined && <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to see its real budget here." />}
      {billingLoading && <p role="status" aria-busy="true">loading billing history…</p>}
      {billing === undefined && !billingLoading && billingError === undefined && <EmptyState title="No billing record" hint="The server has not returned a billing record for this project yet." />}
    </>
  );
}

export function Billing() {
  const { config, reportSessionFailure } = useConnection();
  const { selectedGoalId } = useGoals();
  const [budget, setBudget] = useState<GoalBudgetSummary | undefined>(undefined);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | undefined>(undefined);
  const [budgetStale, setBudgetStale] = useState(false);
  const budgetRef = useRef<GoalBudgetSummary | undefined>(undefined);
  const budgetScopeRef = useRef<{ projectId: string; goalId: string } | undefined>(undefined);
  const [billing, setBilling] = useState<BillingReadModel | undefined>(undefined);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | undefined>(undefined);
  const [billingStale, setBillingStale] = useState(false);
  const billingRef = useRef<BillingReadModel | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) {
      budgetRef.current = undefined;
      budgetScopeRef.current = undefined;
      setBudget(undefined);
      setBudgetError(undefined);
      setBudgetStale(false);
      setBudgetLoading(false);
      return;
    }
    let cancelled = false;
    const sameScope = budgetScopeRef.current?.projectId === config.projectId && budgetScopeRef.current.goalId === selectedGoalId;
    if (!sameScope) {
      budgetRef.current = undefined;
      setBudget(undefined);
    }
    setBudgetLoading(true);
    setBudgetError(undefined);
    setBudgetStale(false);
    void window.maestro.api.getBudgetSummary(selectedGoalId, { projectId: config.projectId })
      .then((loaded) => { if (!cancelled) { budgetScopeRef.current = { projectId: config.projectId, goalId: selectedGoalId }; budgetRef.current = loaded; setBudget(loaded); setBudgetStale(false); } })
      .catch((cause: unknown) => {
        if (!cancelled) {
          if (isSessionFailure(cause)) reportSessionFailure(cause);
          setBudgetError(safeErrorMessage(cause, "Could not load Goal budget"));
          setBudgetStale(budgetRef.current !== undefined);
        }
      })
      .finally(() => { if (!cancelled) setBudgetLoading(false); });
    return () => { cancelled = true; };
  }, [config, selectedGoalId, reportSessionFailure]);

  useEffect(() => {
    if (config === undefined) {
      billingRef.current = undefined;
      setBilling(undefined);
      setBillingLoading(false);
      setBillingError(undefined);
      setBillingStale(false);
      return;
    }
    let cancelled = false;
    setBillingLoading(true);
    setBillingError(undefined);
    setBillingStale(false);
    void window.maestro.api.getBillingSummary(config.projectId)
      .then((loaded) => { if (!cancelled) { billingRef.current = loaded; setBilling(loaded); setBillingStale(false); } })
      .catch((cause: unknown) => {
        if (!cancelled) {
          if (isSessionFailure(cause)) reportSessionFailure(cause);
          setBillingError(safeErrorMessage(cause, "Could not load billing history"));
          setBillingStale(billingRef.current !== undefined);
        }
      })
      .finally(() => { if (!cancelled) setBillingLoading(false); });
    return () => { cancelled = true; };
  }, [config, reportSessionFailure]);

  if (config === undefined) return <EmptyState />;

  const remainingCents = budget === undefined ? undefined : budget.budgetCents - budget.reservedCents;
  const usedPct = budget === undefined || budget.budgetCents <= 0 ? undefined : Math.min(100, Math.round((budget.reservedCents / budget.budgetCents) * 100));

  return (
    <div className="dash-main">
      <div className="dash-head"><div className="dash-title">billing</div></div>
      <div className="dash-sub">budget for the selected Goal · durable project billing rollup</div>

      <BillingStateNotice
        goalSelected={selectedGoalId !== undefined}
        budgetLoading={budgetLoading}
        budgetError={budgetError}
        budgetStale={budgetStale}
        budget={budget}
        billing={billing}
        billingLoading={billingLoading}
        billingError={billingError}
        billingStale={billingStale}
      />

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
