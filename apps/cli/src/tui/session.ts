import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import type { GoalEvent } from "@maestro/api-client";
import { join } from "node:path";

export interface WorkspaceSession {
  workspacePath: string;
  projectId?: string;
  goalId?: string;
  lastEventCursor?: string;
  /** Durable Control Plane conversation identity; never a credential. */
  conversationId?: string;
  model?: string;
}

function sessionId(workspacePath: string): string {
  return createHash("sha256").update(workspacePath).digest("hex");
}

function parseSession(value: unknown): WorkspaceSession | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set(["workspacePath", "projectId", "goalId", "lastEventCursor", "conversationId", "model"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return undefined;
  if (typeof record.workspacePath !== "string" || record.workspacePath.length === 0) return undefined;
  const projectId = record.projectId;
  const goalId = record.goalId;
  const lastEventCursor = record.lastEventCursor;
  const conversationId = record.conversationId;
  const model = record.model;
  for (const value of [projectId, goalId, lastEventCursor, conversationId, model]) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) return undefined;
  }
  return {
    workspacePath: record.workspacePath,
    ...(typeof projectId === "string" ? { projectId } : {}),
    ...(typeof goalId === "string" ? { goalId } : {}),
    ...(typeof lastEventCursor === "string" ? { lastEventCursor } : {}),
    ...(typeof conversationId === "string" ? { conversationId } : {}),
    ...(typeof model === "string" ? { model } : {}),
  };
}

export function sessionFileFor(workspacePath: string, baseDir = join(homedir(), ".maestro", "sessions")): string {
  return join(baseDir, `${sessionId(workspacePath)}.json`);
}

export async function loadWorkspaceSession(workspacePath: string, baseDir?: string): Promise<WorkspaceSession | undefined> {
  try {
    const content = await readFile(sessionFileFor(workspacePath, baseDir), "utf8");
    const session = parseSession(JSON.parse(content));
    return session?.workspacePath === workspacePath ? session : undefined;
  } catch {
    return undefined;
  }
}

export async function saveWorkspaceSession(session: WorkspaceSession, baseDir?: string): Promise<void> {
  const file = sessionFileFor(session.workspacePath, baseDir);
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(session)}\n`, { mode: 0o600 });
}

export function advanceWorkspaceSession(workspacePath: string, current: WorkspaceSession | undefined, event: GoalEvent): WorkspaceSession {
  return {
    workspacePath,
    projectId: current?.projectId ?? event.projectId,
    goalId: current?.goalId ?? event.goalId,
    lastEventCursor: event.cursor,
  };
}

export function startNewConversationSession(workspacePath: string, current: WorkspaceSession | undefined): WorkspaceSession {
  return {
    workspacePath,
    ...(current?.projectId === undefined ? {} : { projectId: current.projectId }),
    ...(current?.lastEventCursor === undefined ? {} : { lastEventCursor: current.lastEventCursor }),
  };
}

export function selectWorkspaceGoal(workspacePath: string, current: WorkspaceSession | undefined, goalId: string): WorkspaceSession {
  if (goalId.trim() === "") throw new Error("Goal ID must be non-empty");
  if (current?.workspacePath !== workspacePath || current.projectId === undefined) throw new Error("A project must be attached before selecting a Goal");
  return { workspacePath, projectId: current.projectId, goalId, ...(current.lastEventCursor === undefined ? {} : { lastEventCursor: current.lastEventCursor }) };
}


export function attachWorkspaceSession(workspacePath: string, current: WorkspaceSession | undefined, projectId: string): WorkspaceSession {
  if (projectId.trim() === "") throw new Error("Project ID must be non-empty");
  if (current?.projectId === projectId) return { workspacePath, projectId, ...(current.goalId === undefined ? {} : { goalId: current.goalId }), ...(current.lastEventCursor === undefined ? {} : { lastEventCursor: current.lastEventCursor }) };
  return { workspacePath, projectId };
}
