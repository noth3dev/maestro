import type { GoalEvent } from "@maestro/api-client";

import { mergeEvents } from "./activity-stream.js";
import { advanceWorkspaceSession, type WorkspaceSession } from "./session.js";

export interface ActivityEventOptions {
  activity: readonly GoalEvent[];
  event: GoalEvent;
  workspacePath: string;
  current: WorkspaceSession | undefined;
  isCurrent: () => boolean;
  saveSession: (session: WorkspaceSession) => Promise<void>;
  onMerged: (activity: GoalEvent[]) => void;
}

/** Apply one live event and persist its cursor while honoring stale-view guards. */
export async function processActivityEvent(
  options: ActivityEventOptions,
): Promise<{ activity: GoalEvent[]; session?: WorkspaceSession } | undefined> {
  if (!options.isCurrent()) return undefined;
  const activity = mergeEvents(options.activity, [options.event]);
  options.onMerged(activity);
  const session = advanceWorkspaceSession(options.workspacePath, options.current, options.event);
  if (!options.isCurrent()) return { activity };
  await options.saveSession(session);
  if (!options.isCurrent()) return { activity };
  return { activity, session };
}
