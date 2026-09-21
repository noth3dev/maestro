import { useEffect, useState } from "react";
import type { EvidenceBundleRead } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";
import type { GoalReadScope } from "./useGoalWorkers.js";

export function useGoalEvidenceBundle(refreshCursor = "0"): {
  evidenceBundle: EvidenceBundleRead | undefined;
  error: string | undefined;
  loadedFor: GoalReadScope | undefined;
} {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [evidenceBundle, setEvidenceBundle] = useState<EvidenceBundleRead | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadedFor, setLoadedFor] = useState<GoalReadScope | undefined>(undefined);

  useEffect(() => {
    setEvidenceBundle(undefined);
    setLoadedFor(undefined);
    setError(undefined);
    if (config === undefined || selectedGoalId === undefined) return;
    const scope = { projectId: config.projectId, goalId: selectedGoalId, refreshKey: refreshCursor };
    let cancelled = false;
    window.maestro.api.getEvidenceBundle(selectedGoalId, { projectId: config.projectId })
      .then((bundle) => {
        if (!cancelled) {
          setEvidenceBundle(bundle);
          setLoadedFor(scope);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadedFor(scope);
        if (typeof cause === "object" && cause !== null && "status" in cause && (cause as { status?: unknown }).status === 404) return;
        setError(cause instanceof Error ? cause.message : "Could not load the evidence bundle");
      });
    return () => { cancelled = true; };
  }, [config, selectedGoalId, refreshCursor]);

  return { evidenceBundle, error, loadedFor };
}
