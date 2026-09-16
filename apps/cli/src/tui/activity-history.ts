import type { ApiClient, GoalEvent } from "@maestro/api-client";

export interface ActivityHistoryOptions {
  client: Pick<ApiClient, "listEvents">;
  projectId: string;
  isCurrent: () => boolean;
}

/** Load the bounded event history while allowing the owning view to go stale. */
export async function loadActivityHistory(options: ActivityHistoryOptions): Promise<GoalEvent[] | undefined> {
  let cursor = "0";
  const history: GoalEvent[] = [];
  for (let page = 0; page < 64; page += 1) {
    const result = await options.client.listEvents({ projectId: options.projectId, after: cursor });
    if (!options.isCurrent()) return undefined;
    history.push(...result.events);
    if (result.events.length === 0 || result.nextCursor === cursor || result.events.length < 100) break;
    cursor = result.nextCursor;
  }
  if (!options.isCurrent()) return undefined;
  return history;
}
