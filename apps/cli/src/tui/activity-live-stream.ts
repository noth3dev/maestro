import type { GoalEvent } from "@maestro/api-client";

import { processActivityEvent } from "./activity-event.js";
import { runActivityStream, type EventStreamClient } from "./activity-stream.js";
import type { WorkspaceSession } from "./session.js";
import type { TranscriptLine } from "./theme.js";

export interface LiveActivityState {
  activity: readonly GoalEvent[];
  session: WorkspaceSession | undefined;
}

export interface LiveActivityStreamOptions {
  client: EventStreamClient<GoalEvent>;
  projectId: string;
  signal: AbortSignal;
  readState: () => LiveActivityState;
  workspacePath: string;
  isCurrent: () => boolean;
  dismissSplash: () => void;
  setActivity: (activity: GoalEvent[]) => void;
  setSession: (session: WorkspaceSession) => void;
  saveSession: (session: WorkspaceSession) => Promise<void>;
  append: (line: string | TranscriptLine) => void;
  render: () => void;
}

export async function runLiveActivityStream(options: LiveActivityStreamOptions): Promise<void> {
  const initialState = options.readState();
  const cursor = initialState.activity.at(-1)?.cursor ?? initialState.session?.lastEventCursor ?? "0";
  await runActivityStream({
    client: options.client,
    projectId: options.projectId,
    cursor,
    signal: options.signal,
    maxReconnectAttempts: 5,
    onReconnect: (attempt, maxAttempts) =>
      options.append({ kind: "warning", text: `Activity stream reconnecting (${attempt}/${maxAttempts})` }),
    onEvent: async (event) => {
      if (!options.isCurrent()) return;
      options.dismissSplash();
      const current = options.readState();
      const update = await processActivityEvent({
        activity: current.activity,
        event,
        workspacePath: options.workspacePath,
        current: current.session,
        isCurrent: options.isCurrent,
        saveSession: options.saveSession,
        onMerged: options.setActivity,
      });
      if (update === undefined) return;
      options.setActivity(update.activity);
      if (update.session === undefined) return;
      options.setSession(update.session);
      options.render();
    },
    onUnavailable: options.append,
    onFailure: options.append,
  });
}
