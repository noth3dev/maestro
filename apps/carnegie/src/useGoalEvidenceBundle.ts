import { useEffect, useState } from "react";
import type { EvidenceBundleRead } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { useGoals } from "./goals.js";

export function useGoalEvidenceBundle(refreshCursor = "0"): { evidenceBundle: EvidenceBundleRead | undefined; error: string | undefined } {
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
        if (typeof cause === "object" && cause !== null && "status" in cause && (cause as { status?: unknown }).status === 404) { setEvidenceBundle(undefined); return; }
        setError(cause instanceof Error ? cause.message : "Could not load the evidence bundle");
      });
    return () => { cancelled = true; };
  }, [config, selectedGoalId, refreshCursor]);

  return { evidenceBundle, error };
}
