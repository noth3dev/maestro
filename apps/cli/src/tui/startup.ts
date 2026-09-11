import { createApiClient, type ApiClient } from "@maestro/api-client";
import { resolveWorkspace, type Workspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { resolveLocalConnection } from "./local-bootstrap.js";
import { discoverWorkspaceProject, discoverWorkspaceProjectFromControlPlane } from "./commands/read-commands.js";
import { loadWorkspaceSession, attachWorkspaceSession, saveWorkspaceSession } from "./session.js";
import type { TuiShellState } from "./components/shell.js";
import type { CliIo } from "../main.js";

export interface InteractiveTuiOptions { cwd: string; env: Record<string, string | undefined>; io: CliIo; }

export function shouldAutoBootstrapLocal(env: Record<string, string | undefined>): boolean {
  return (env.MAESTRO_API_URL?.trim() ?? "") === "" && (env.MAESTRO_API_TOKEN?.trim() ?? "") === "" && env.MAESTRO_DISABLE_LOCAL_AUTOSTART !== "true";
}

export async function initializeTui(options: InteractiveTuiOptions): Promise<{
  workspace: Workspace;
  startupError?: string;
  connection: Awaited<ReturnType<typeof resolveConnection>>;
  session: Awaited<ReturnType<typeof loadWorkspaceSession>>;
  project: ReturnType<typeof discoverWorkspaceProject>;
  projectDiscoveryNotice?: string;
  client?: ApiClient;
  state: TuiShellState;
}> {

  let workspace: Workspace;
  let startupError: string | undefined;
  try {
    workspace = await resolveWorkspace(options.cwd);
  } catch (error) {
    workspace = { cwd: options.cwd };
    startupError = error instanceof Error ? error.message : "Workspace could not be resolved";
  }
  let connection = await resolveConnection(options.env);
  if (connection.kind !== "configured" && shouldAutoBootstrapLocal(options.env)) {
    connection = await resolveLocalConnection({
      env: options.env,
      ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
    });
  }
  const controlPlane =
    connection.kind === "configured"
      ? await ensureLocalControlPlane({ apiUrl: connection.apiUrl, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) })
      : undefined;
  let session = await loadWorkspaceSession(workspace.cwd);
  const connectionReady = connection.kind === "configured" && controlPlane?.kind === "ready";
  let project = discoverWorkspaceProject(workspace.cwd, session);
  let projectDiscoveryNotice: string | undefined;
  let client: ApiClient | undefined;
  if (connectionReady && connection.kind === "configured") {
    try {
      client = createApiClient({
        baseUrl: connection.apiUrl,
        token: connection.token,
        ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
      });
      const previousProject = project;
      const discovered = await discoverWorkspaceProjectFromControlPlane({ workspacePath: workspace.cwd, session, client });
      project = discovered;
      if (discovered.kind === "attached") {
        if (previousProject.kind !== "attached" || previousProject.projectId !== discovered.projectId) {
          session = attachWorkspaceSession(workspace.cwd, session, discovered.projectId);
          await saveWorkspaceSession(session);
        }
      } else {
        projectDiscoveryNotice = discovered.reason;
      }
    } catch {
      // The resolver already validates the endpoint. Keep the UI truthful if
      // a future client invariant rejects it at construction time.
      client = undefined;
    }
  }
  const initialModel = options.env.MAESTRO_MODEL?.trim() || session?.model;
  const state: TuiShellState = {
    workspace,
    ...(initialModel === undefined ? {} : { model: initialModel }),
    mode: "maestro",
    connection:
      startupError !== undefined
        ? { kind: "error", message: `Workspace unavailable: ${startupError}` }
        : !connectionReady
          ? connection.kind !== "configured"
            ? { kind: "setup-required", message: connection.reason }
            : { kind: "error", message: controlPlane?.kind === "unavailable" ? controlPlane.reason : "Control Plane is not reachable" }
          : client === undefined
            ? { kind: "error", message: "Control Plane client could not be created" }
            : { kind: "connected" },
    goal: { kind: "empty" },
    workers: { kind: "empty" },
    approvals: { kind: "error", message: "Approval read surface is not available" },
    budget: { kind: "empty" },
  };

  return { workspace, ...(startupError === undefined ? {} : { startupError }), connection, session, project, ...(projectDiscoveryNotice === undefined ? {} : { projectDiscoveryNotice }), ...(client === undefined ? {} : { client }), state };
}
