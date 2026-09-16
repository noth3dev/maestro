import type { ApiClient } from "@maestro/api-client";

import { dashboardErrorState, dashboardStateFromReadModel, type DashboardStateValues } from "./dashboard-state.js";
import type { DashboardReadModel, readDashboard } from "./commands/read-commands.js";

export interface DashboardRefreshOptions {
  client: ApiClient;
  projectId: string;
  goalId?: string;
  readDashboard: typeof readDashboard;
  isCurrent?: () => boolean;
  setDashboardState: (state: DashboardStateValues) => void;
  setRecovery: (dashboard: DashboardReadModel) => void;
  render: () => void;
}

export async function refreshDashboardState(options: DashboardRefreshOptions): Promise<void> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!isCurrent()) return;
  options.setDashboardState({ goal: { kind: "loading" }, workers: { kind: "loading" }, budget: { kind: "loading" } });
  options.render();
  try {
    const dashboard = await options.readDashboard({
      client: options.client,
      projectId: options.projectId,
      ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    });
    if (!isCurrent()) return;
    options.setDashboardState(dashboardStateFromReadModel(dashboard));
    options.setRecovery(dashboard);
    options.render();
  } catch (error) {
    if (!isCurrent()) return;
    const message = error instanceof Error ? error.message : "Control Plane read failed";
    options.setDashboardState(dashboardErrorState(message));
    options.render();
  }
}
