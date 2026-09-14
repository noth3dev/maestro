import { useEffect, useState } from "react";
import type { GoalGitIntegrationState } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export function useGitIntegrationState(): { state: GoalGitIntegrationState | undefined; loading: boolean; error: string | undefined } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [state, setState] = useState<GoalGitIntegrationState | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    window.maestro.api
      .getGitIntegrationState(selectedGoalId, { projectId: config.projectId })
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Git integration state");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedGoalId]);

  return { state, loading, error };
}
