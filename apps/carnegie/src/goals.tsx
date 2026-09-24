import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { GoalList, GoalResult, StartGoalOrchestrationStatus } from "@maestro/api-client";
import { useConnection } from "./connection.js";
import { loadGoalOrchestrationStatuses, loadGoalsAfterLaunch, selectedGoalIdAfterRefresh } from "./lib/goal-operations.js";

interface GoalLoadScope {
  projectId: string;
  refreshKey: string | undefined;
}

interface GoalsContextValue {
  goals: GoalResult[] | undefined;
  orchestrationByGoalId: Readonly<Record<string, StartGoalOrchestrationStatus>>;
  selectedGoalId: string | undefined;
  selectGoal: (goalId: string) => void;
  refresh: () => Promise<GoalList | undefined>;
  loadedFor: GoalLoadScope | undefined;
  loading: boolean;
  error: unknown;
}

const GoalsContext = createContext<GoalsContextValue | undefined>(undefined);

export function GoalsProvider({ children, refreshKey }: { children: ReactNode; refreshKey?: string }) {
  const { config } = useConnection();
  const [goals, setGoals] = useState<GoalResult[] | undefined>(undefined);
  const [orchestrationByGoalId, setOrchestrationByGoalId] = useState<Readonly<Record<string, StartGoalOrchestrationStatus>>>({});
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>(undefined);
  const [loadedFor, setLoadedFor] = useState<GoalLoadScope | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const requestGeneration = useRef(0);
  const previousProjectId = useRef(config?.projectId);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (config === undefined) {
      setGoals(undefined);
      setOrchestrationByGoalId({});
      setSelectedGoalId(undefined);
      setLoadedFor(undefined);
      setError(undefined);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(undefined);
    setGoals(undefined);
    setOrchestrationByGoalId({});
    try {
      const page = await loadGoalsAfterLaunch(window.maestro.api, { projectId: config.projectId });
      const orchestration = await loadGoalOrchestrationStatuses(window.maestro.api, { projectId: config.projectId }, page.goals);
      if (generation !== requestGeneration.current) return undefined;
      setGoals(page.goals);
      setOrchestrationByGoalId(orchestration);
      setSelectedGoalId((current) => selectedGoalIdAfterRefresh(current, page.goals));
      setLoadedFor({ projectId: config.projectId, refreshKey });
      return page;
    } catch (cause) {
      if (generation === requestGeneration.current) setError(cause);
      return undefined;
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [config, refreshKey]);

  useEffect(() => {
    if (previousProjectId.current !== config?.projectId) {
      setGoals(undefined);
      setOrchestrationByGoalId({});
      setSelectedGoalId(undefined);
      previousProjectId.current = config?.projectId;
    }
    void refresh();
  }, [config?.projectId, refreshKey, refresh]);

  return (
    <GoalsContext.Provider
      value={{ goals, orchestrationByGoalId, selectedGoalId, selectGoal: setSelectedGoalId, refresh, loadedFor, loading, error }}
    >
      {children}
    </GoalsContext.Provider>
  );
}

export function useGoals(): GoalsContextValue {
  const value = useContext(GoalsContext);
  if (value === undefined) throw new Error("useGoals must be used within a GoalsProvider");
  return value;
}
