import { useEffect, useRef, useState } from "react";
import type { WorkerList } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export interface GoalReadScope {
  projectId: string;
  goalId: string;
  refreshKey: string;
}

export function useGoalWorkers(refreshCursor = "0"): {
  workers: WorkerList["workers"] | undefined;
  loading: boolean;
  error: string | undefined;
  loadedFor: GoalReadScope | undefined;
} {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [workers, setWorkers] = useState<WorkerList["workers"] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadedFor, setLoadedFor] = useState<GoalReadScope | undefined>(undefined);
  const scopeIdentityRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const scopeIdentity = config === undefined || selectedGoalId === undefined ? undefined : `${config.projectId}:${selectedGoalId}`;
    if (scopeIdentityRef.current !== scopeIdentity) {
      scopeIdentityRef.current = scopeIdentity;
      setWorkers(undefined);
      setLoadedFor(undefined);
      setError(undefined);
    }
    if (config === undefined || selectedGoalId === undefined) {
      setLoading(false);
      return;
    }
    const scope = { projectId: config.projectId, goalId: selectedGoalId, refreshKey: refreshCursor };
    let cancelled = false;
    setLoading(true);
    window.maestro.api
      .listWorkersForGoal(selectedGoalId, { projectId: config.projectId })
      .then((result) => {
        if (!cancelled) {
          setWorkers(result.workers);
          setLoadedFor(scope);
          setError(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadedFor(scope);
          setError(cause instanceof Error ? cause.message : "Could not load workers for this Goal");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedGoalId, refreshCursor]);

  return { workers, loading, error, loadedFor };
}
