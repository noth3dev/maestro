import { readStartGoalOrchestration, type StartGoalOrchestrationRun } from "@maestro/persistence";
import type { Pool } from "pg";

export class StartGoalOrchestrationStatusNotFoundError extends Error {
  constructor() {
    super("Goal orchestration status was not found");
    this.name = "StartGoalOrchestrationStatusNotFoundError";
  }
}

export interface StartGoalOrchestrationStatusService {
  get(goalId: string, projectId: string): Promise<StartGoalOrchestrationRun>;
}

export function createStartGoalOrchestrationStatusService(options: { readonly pool: Pool }): StartGoalOrchestrationStatusService {
  return {
    async get(goalId, projectId) {
      const run = await readStartGoalOrchestration(options.pool, goalId);
      if (run === undefined || run.projectId !== projectId) throw new StartGoalOrchestrationStatusNotFoundError();
      return run;
    },
  };
}
