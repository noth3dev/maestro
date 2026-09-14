import { useEffect, useState } from "react";
import type { ApiClient, ProjectionReadModel } from "@carnegie/api-client";

interface ProjectionState {
  projection: ProjectionReadModel | undefined;
  loading: boolean;
  error: string | undefined;
}

export function useGoalProjection(api: Pick<ApiClient, "getProjection"> | undefined, projectId: string | undefined, goalId: string | undefined, refreshCursor: string): ProjectionState {
  const [state, setState] = useState<ProjectionState>({ projection: undefined, loading: false, error: undefined });

  useEffect(() => {
    if (api === undefined || projectId === undefined) return;
    let cancelled = false;
    setState((current) => ({ projection: current.projection, loading: true, error: undefined }));
    api.getProjection(goalId === undefined ? { projectId } : { projectId, goalId })
      .then((projection) => { if (!cancelled) setState({ projection, loading: false, error: undefined }); })
      .catch((cause: unknown) => { if (!cancelled) setState((current) => ({ projection: current.projection, loading: false, error: cause instanceof Error ? cause.message : "Could not load the Goal projection" })); });
    return () => { cancelled = true; };
  }, [api, projectId, goalId, refreshCursor]);

  return state;
}
