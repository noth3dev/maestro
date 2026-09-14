import { useEffect, useState } from "react";
import { ApiError, type EvidenceBundleRead } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export function useGoalEvidenceBundle(): { evidenceBundle: EvidenceBundleRead | undefined; error: string | undefined } {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [evidenceBundle, setEvidenceBundle] = useState<EvidenceBundleRead | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let cancelled = false;
    setError(undefined);
    window.maestro.api.getEvidenceBundle(selectedGoalId, { projectId: config.projectId })
      .then((bundle) => { if (!cancelled) setEvidenceBundle(bundle); })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 404) { setEvidenceBundle(undefined); return; }
        setError(cause instanceof Error ? cause.message : "Could not load the evidence bundle");
      });
    return () => { cancelled = true; };
  }, [config, selectedGoalId]);

  return { evidenceBundle, error };
}
