import { createApiClient, type ApiClient } from "@maestro/api-client";
import { resolveWorkspace, workspaceIdentity, type Workspace } from "./workspace.js";
import { resolveConnection } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { resolveLocalConnection, type LocalBootstrapStepEvent } from "./local-bootstrap.js";
import { discoverWorkspaceProject, discoverWorkspaceProjectFromControlPlane } from "./commands/read-commands.js";
import { loadWorkspaceSession, attachWorkspaceSession, saveWorkspaceSession } from "./session.js";
import type { TuiShellState } from "./components/shell.js";
import type { CliIo } from "../main.js";

export interface InteractiveTuiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  io: CliIo;
  onSetupStep?: (event: LocalBootstrapStepEvent) => void;
}

export function shouldAutoBootstrapLocal(env: Record<string, string | undefined>): boolean {
  return (env.MAESTRO_API_URL?.trim() ?? "") === "" && (env.MAESTRO_API_TOKEN?.trim() ?? "") === "" && env.MAESTRO_DISABLE_LOCAL_AUTOSTART !== "true";
}

export async function hydrateOrganizationState(client: Pick<ApiClient, "getOrganization">): Promise<NonNullable<TuiShellState["organization"]>> {
  try {
    const organization = await client.getOrganization();
    return { kind: "value", value: { departments: organization.departments.map((department) => department.displayName) } };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Organization read failed" };
  }
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
  const setupSteps: LocalBootstrapStepEvent[] = [];
  const onSetupStep = (event: LocalBootstrapStepEvent): void => {
    const existing = setupSteps.findIndex((step) => step.step === event.step);
    if (existing === -1) setupSteps.push(event);
    else setupSteps[existing] = event;
    options.onSetupStep?.(event);
  };
  let connection = await resolveConnection(options.env);
  if (connection.kind !== "configured" && shouldAutoBootstrapLocal(options.env)) {
    connection = await resolveLocalConnection({
      env: options.env,
      ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }),
      onStep: onSetupStep,
    });
  }
  const controlPlane =
    connection.kind === "configured"
      ? await ensureLocalControlPlane({ apiUrl: connection.apiUrl, ...(options.io.fetch === undefined ? {} : { fetch: options.io.fetch }) })
      : undefined;
  const sessionWorkspacePath = workspaceIdentity(workspace);
  let session = await loadWorkspaceSession(sessionWorkspacePath);
  const connectionReady = connection.kind === "configured" && controlPlane?.kind === "ready";
  let project = discoverWorkspaceProject(sessionWorkspacePath, session);
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
      const discovered = await discoverWorkspaceProjectFromControlPlane({ workspacePath: sessionWorkspacePath, session, client });
      project = discovered;
      if (discovered.kind === "attached") {
        if (previousProject.kind !== "attached" || previousProject.projectId !== discovered.projectId) {
          session = attachWorkspaceSession(sessionWorkspacePath, session, discovered.projectId);
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
  const organizationState: NonNullable<TuiShellState["organization"]> = client === undefined
    ? { kind: "empty" }
    : await hydrateOrganizationState(client);
  const initialModel = options.env.MAESTRO_MODEL?.trim() || session?.model;
  const state: TuiShellState = {
    workspace,
    ...(setupSteps.length === 0 ? {} : { setupSteps }),
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
    organization: organizationState,
    project: project.kind === "attached" ? { kind: "attached" } : { kind: "unavailable", guidance: projectDiscoveryNotice ?? project.reason },
  };

  return { workspace, ...(startupError === undefined ? {} : { startupError }), connection, session, project, ...(projectDiscoveryNotice === undefined ? {} : { projectDiscoveryNotice }), ...(client === undefined ? {} : { client }), state };
}
