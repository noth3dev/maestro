import { useCallback, useEffect, useState } from "react";
import type { GoalBudgetSummary } from "@maestro/api-client";
import type { Certification } from "@maestro/contracts";
import { loadGoalPageData, type GoalPageData } from "./lib/goal-data.js";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";
import type { GoalReadScope } from "./useGoalWorkers.js";

export interface GoalDetail extends GoalPageData {
  budget: GoalBudgetSummary;
  certifications: Certification[];
}

export function useGoalDetail(refreshCursor = "0"): { detail: GoalDetail | undefined; loading: boolean; error: string | undefined; loadedFor: GoalReadScope | undefined; errorLoadedFor: GoalReadScope | undefined; refresh: () => void } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [detail, setDetail] = useState<GoalDetail | undefined>(undefined);
  const [loadedFor, setLoadedFor] = useState<GoalReadScope | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [errorLoadedFor, setErrorLoadedFor] = useState<GoalReadScope | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((current) => current + 1), []);

  useEffect(() => {
    setDetail(undefined);
    setLoadedFor(undefined);
    setError(undefined);
    setErrorLoadedFor(undefined);
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    const query = { projectId: config.projectId, goalId: selectedGoalId };
    const scope = { projectId: config.projectId, goalId: selectedGoalId, refreshKey: refreshCursor };
    Promise.all([
      loadGoalPageData(window.maestro.api, query),
      window.maestro.api.getBudgetSummary(selectedGoalId, { projectId: config.projectId }),
      window.maestro.api.listCertifications(selectedGoalId, { projectId: config.projectId }),
    ])
      .then(([page, budget, certificationList]) => {
        if (cancelled) return;
        setDetail({ ...page, budget, certifications: certificationList.certifications });
        setLoadedFor(scope);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load Goal state");
          setErrorLoadedFor(scope);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedGoalId, reloadToken, refreshCursor]);

  return { detail, loading, error, loadedFor, errorLoadedFor, refresh };
}
