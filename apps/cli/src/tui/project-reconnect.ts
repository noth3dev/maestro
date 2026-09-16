import type { ApiClient } from "@maestro/api-client";
import { discoverWorkspaceProject, discoverWorkspaceProjectFromControlPlane, type WorkspaceProject } from "./commands/read-commands.js";
import { attachWorkspaceSession, type WorkspaceSession } from "./session.js";

export interface ReconnectWorkspaceProjectOptions {
  workspacePath: string;
  session: WorkspaceSession | undefined;
  client: Pick<ApiClient, "listProjects">;
  saveSession: (session: WorkspaceSession) => Promise<void>;
  syncModelState: () => void;
  onDiscovered: (project: WorkspaceProject) => void;
}

export interface ReconnectWorkspaceProjectResult {
  project: WorkspaceProject;
  session: WorkspaceSession | undefined;
  notice?: string;
}

export async function reconnectWorkspaceProject(options: ReconnectWorkspaceProjectOptions): Promise<ReconnectWorkspaceProjectResult> {
  const previousProject = discoverWorkspaceProject(options.workspacePath, options.session);
  const project = await discoverWorkspaceProjectFromControlPlane({
    workspacePath: options.workspacePath,
    session: options.session,
    client: options.client,
  });
  options.onDiscovered(project);
  let session = options.session;
  if (project.kind === "attached") {
    if (previousProject.kind !== "attached" || previousProject.projectId !== project.projectId) {
      session = attachWorkspaceSession(options.workspacePath, session, project.projectId);
      options.syncModelState();
      await options.saveSession(session);
    }
    return { project, session };
  }
  return { project, session, notice: project.reason };
}
