import type { ApiClient, GoalEvent } from "@maestro/api-client";

import { loadActivityHistory } from "./activity-history.js";
import { mergeEvents } from "./activity-stream.js";

export interface ActivityHistoryHydrationOptions {
  client: Pick<ApiClient, "listEvents">;
  projectId: string;
  readActivity: () => readonly GoalEvent[];
  setActivity: (activity: GoalEvent[]) => void;
  isCurrent: () => boolean;
  onWarning: (message: string) => void;
  render: () => void;
}

export async function hydrateActivityHistory(options: ActivityHistoryHydrationOptions): Promise<void> {
  try {
    const history = await loadActivityHistory({
      client: options.client,
      projectId: options.projectId,
      isCurrent: options.isCurrent,
    });
    if (history === undefined) return;
    options.setActivity(mergeEvents(options.readActivity(), history));
    options.render();
  } catch (error) {
    if (options.isCurrent()) {
      options.onWarning(`Activity history unavailable: ${error instanceof Error ? error.message : "Control Plane request failed"}`);
    }
  }
}
