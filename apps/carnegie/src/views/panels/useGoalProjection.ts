import { useEffect, useState } from "react";
import type { ApiClient, ProjectionReadModel } from "@maestro/api-client";
import type { GoalReadScope } from "../../useGoalWorkers.js";

interface ProjectionState {
  projection: ProjectionReadModel | undefined;
  loading: boolean;
  error: string | undefined;
  loadedFor: GoalReadScope | undefined;
}

export function useGoalProjection(api: Pick<ApiClient, "getProjection"> | undefined, projectId: string | undefined, goalId: string | undefined, refreshCursor: string): ProjectionState {
  const [state, setState] = useState<ProjectionState>({ projection: undefined, loading: false, error: undefined, loadedFor: undefined });

  useEffect(() => {
    setState({ projection: undefined, loading: false, error: undefined, loadedFor: undefined });
    if (api === undefined || projectId === undefined) return;
    const scope = goalId === undefined ? undefined : { projectId, goalId, refreshKey: refreshCursor };
    let cancelled = false;
    setState({ projection: undefined, loading: true, error: undefined, loadedFor: undefined });
    api.getProjection(goalId === undefined ? { projectId } : { projectId, goalId })
      .then((projection) => {
        if (!cancelled) setState({ projection, loading: false, error: undefined, loadedFor: scope });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ projection: undefined, loading: false, loadedFor: scope, error: cause instanceof Error ? cause.message : "Could not load the Goal projection" });
      });
    return () => { cancelled = true; };
  }, [api, projectId, goalId, refreshCursor]);

  return state;
}
