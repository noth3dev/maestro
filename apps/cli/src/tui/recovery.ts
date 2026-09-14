import type { WorkspaceSession } from "./session.js";

export type RecoverySummary =
  | { kind: "new"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "attached"; projectId: string; goalId?: string; lastEventCursor?: string }
  | { kind: "stale"; projectId: string; goalId?: string; lastEventCursor?: string; goalState: string; activeWorkers?: number };

export interface ServerRecoveryState { goalState?: string; activeWorkers?: number }

export function reconcileTuiSession(workspacePath: string, session: WorkspaceSession | undefined, server?: ServerRecoveryState): RecoverySummary {
  if (session === undefined) return { kind: "new", message: "No saved Maestro session for this workspace" };
  if (session.workspacePath !== workspacePath || session.projectId === undefined || session.projectId.trim() === "") return { kind: "unavailable", message: "Saved session has no valid project attachment" };
  const base = { projectId: session.projectId, ...(session.goalId === undefined ? {} : { goalId: session.goalId }), ...(session.lastEventCursor === undefined ? {} : { lastEventCursor: session.lastEventCursor }) };
  if (server?.goalState === "recovering" || server?.goalState === "unknown") return { kind: "stale", ...base, goalState: server.goalState, ...(server.activeWorkers === undefined ? {} : { activeWorkers: server.activeWorkers }) };
  return { kind: "attached", ...base };
}
