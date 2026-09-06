import { useEffect, useState } from "react";
import type { ImprovementDigestList } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export function useGoalImprovementDigests(): { digests: ImprovementDigestList["digests"] | undefined; loading: boolean; error: string | undefined } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [digests, setDigests] = useState<ImprovementDigestList["digests"] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    window.maestro.api
      .listImprovementDigestsForGoal(selectedGoalId, { projectId: config.projectId })
      .then((result) => {
        if (!cancelled) setDigests(result.digests);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load improvement digests for this Goal");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedGoalId]);

  return { digests, loading, error };
}
