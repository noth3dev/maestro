import { useEffect, useState } from "react";
import type { ArrangementsRead } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export function useGoalArrangements(): { arrangements: ArrangementsRead | undefined; loading: boolean; error: string | undefined } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [arrangements, setArrangements] = useState<ArrangementsRead | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setArrangements(undefined);
    window.maestro.api.getArrangements(selectedGoalId, { projectId: config.projectId })
      .then((result) => { if (!cancelled) setArrangements(result); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load arrangements for this Goal"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [config, selectedGoalId]);

  return { arrangements, loading, error };
}
