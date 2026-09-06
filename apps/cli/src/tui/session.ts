import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WorkspaceSession {
  workspacePath: string;
  projectId?: string;
  goalId?: string;
  lastEventCursor?: string;
}

function sessionId(workspacePath: string): string {
  return createHash("sha256").update(workspacePath).digest("hex");
}

export function sessionFileFor(workspacePath: string, baseDir = join(homedir(), ".maestro", "sessions")): string {
  return join(baseDir, `${sessionId(workspacePath)}.json`);
}

export async function loadWorkspaceSession(workspacePath: string, baseDir?: string): Promise<WorkspaceSession | undefined> {
  try {
    const content = await readFile(sessionFileFor(workspacePath, baseDir), "utf8");
    const session = JSON.parse(content) as WorkspaceSession;
    return session.workspacePath === workspacePath ? session : undefined;
  } catch {
    return undefined;
  }
}

export async function saveWorkspaceSession(session: WorkspaceSession, baseDir?: string): Promise<void> {
  const file = sessionFileFor(session.workspacePath, baseDir);
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(session)}\n`, { mode: 0o600 });
}
