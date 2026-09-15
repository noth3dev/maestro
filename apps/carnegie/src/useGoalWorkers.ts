import { useEffect, useState } from "react";
import type { WorkerList } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export function useGoalWorkers(refreshCursor = "0"): { workers: WorkerList["workers"] | undefined; loading: boolean; error: string | undefined } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [workers, setWorkers] = useState<WorkerList["workers"] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    window.maestro.api
      .listWorkersForGoal(selectedGoalId, { projectId: config.projectId })
      .then((result) => {
        if (!cancelled) setWorkers(result.workers);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load workers for this Goal");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedGoalId, refreshCursor]);

  return { workers, loading, error };
}
