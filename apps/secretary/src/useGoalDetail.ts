import { useEffect, useState } from "react";
import type { GoalBudgetSummary } from "@maestro/api-client";
import type { Certification } from "@maestro/contracts";
import { loadGoalPageData, type GoalPageData } from "./lib/goal-data.js";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export interface GoalDetail extends GoalPageData {
  budget: GoalBudgetSummary;
  certifications: Certification[];
}

export function useGoalDetail(): { detail: GoalDetail | undefined; loading: boolean; error: string | undefined } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [detail, setDetail] = useState<GoalDetail | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    const query = { projectId: config.projectId, goalId: selectedGoalId };
    Promise.all([
      loadGoalPageData(window.maestro.api, query),
      window.maestro.api.getBudgetSummary(selectedGoalId, { projectId: config.projectId }),
      window.maestro.api.listCertifications(selectedGoalId, { projectId: config.projectId }),
    ])
      .then(([page, budget, certificationList]) => {
        if (cancelled) return;
        setDetail({ ...page, budget, certifications: certificationList.certifications });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Goal state");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedGoalId]);

  return { detail, loading, error };
}
