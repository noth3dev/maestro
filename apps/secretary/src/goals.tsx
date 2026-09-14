import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { GoalResult } from "@maestro/api-client";
import { useConnection } from "./connection.js";

interface GoalsContextValue {
  goals: GoalResult[] | undefined;
  selectedGoalId: string | undefined;
  selectGoal: (goalId: string) => void;
  refresh: () => Promise<void>;
}

const GoalsContext = createContext<GoalsContextValue | undefined>(undefined);

export function GoalsProvider({ children }: { children: ReactNode }) {
  const { config } = useConnection();
  const [goals, setGoals] = useState<GoalResult[] | undefined>(undefined);
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (config === undefined) return;
    const page = await window.maestro.api.listGoals(config.projectId);
    setGoals(page.goals);
    setSelectedGoalId((current) => current ?? page.goals[0]?.goalId);
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <GoalsContext.Provider value={{ goals, selectedGoalId, selectGoal: setSelectedGoalId, refresh }}>
      {children}
    </GoalsContext.Provider>
  );
}

export function useGoals(): GoalsContextValue {
  const value = useContext(GoalsContext);
  if (value === undefined) throw new Error("useGoals must be used within a GoalsProvider");
  return value;
}
