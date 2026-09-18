import { createApiClient } from "@maestro/api-client";
import { resolveRetryWorkspace } from "../retry-workspace.js";
import { ensureLocalControlPlane, resolveLocalConnection } from "@maestro/local-backend";
import { shouldAutoBootstrapLocal } from "../startup.js";
import { hydrateOrganizationOnReconnect } from "../entry-hydration.js";
import { reconnectWorkspaceProject } from "../project-reconnect.js";
import { discoverWorkspaceProject } from "../commands/read-commands.js";
import { saveWorkspaceSession } from "../session.js";
import { reconcileTuiSession } from "../recovery.js";
import type { WorkspaceSession } from "../session.js";
import type { TuiController } from "./controller.js";

export class ConnectionFlow {
  constructor(private c: TuiController) {}

  applySuccessfulRetryHandoff = async (sessionResult: WorkspaceSession | undefined, notice: string | undefined): Promise<void> => {
    const c = this.c;
    c.session = sessionResult;
    await hydrateOrganizationOnReconnect(c.state, c.client!);
    c.state.connection = { kind: "connected" };
    c.recovery = reconcileTuiSession(c.sessionWorkspacePath, c.session);
    c.view.appendSuccess("Control Plane connected.");
    if (notice !== undefined) c.view.appendWarning(notice);
    void c.refreshDashboard();
    c.activitySync.restartActivity();
    void c.auth.offerAutomaticProviderSignIn();
  };

  retryConnection = async (): Promise<void> => {
    const c = this.c;
    c.connectionGeneration += 1;
    c.invalidateDashboardRefreshes();
    c.view.appendWarning("Retrying Maestro startup checks…");
    if (c.startupError !== undefined) {
      const retriedWorkspace = await resolveRetryWorkspace(c.options.cwd);
      if (retriedWorkspace.kind === "error") {
        c.startupError = retriedWorkspace.message;
        c.state.connection = { kind: "error", message: `Workspace unavailable: ${c.startupError}` };
        c.view.appendError(`Startup retry failed: ${c.startupError}`);
        return;
      }
      c.workspace = retriedWorkspace.workspace;
      c.state.workspace = c.workspace;
      c.startupError = undefined;
    }
    let connection = c.connection;
    if (connection.kind !== "configured") {
      if (shouldAutoBootstrapLocal(c.options.env)) {
        const resolved = await resolveLocalConnection({
          env: c.options.env,
          ...(c.options.io.fetch === undefined ? {} : { fetch: c.options.io.fetch }),
          onStep: c.updateSetupStep,
        });
        c.connection = resolved;
        connection = resolved;
        if (connection.kind !== "configured") {
          c.state.connection = { kind: "setup-required", message: connection.reason };
          c.view.appendWarning(`Startup retry blocked: ${connection.reason}`);
          return;
        }
      } else {
        c.state.connection = { kind: "setup-required", message: connection.reason };
        c.view.appendWarning(`Startup retry blocked: ${connection.reason}`);
        return;
      }
    }
    if (connection.kind !== "configured") return;
    const health = await ensureLocalControlPlane({
      apiUrl: connection.apiUrl,
      ...(c.options.io.fetch === undefined ? {} : { fetch: c.options.io.fetch }),
    });
    if (health.kind !== "ready") {
      c.state.connection = { kind: "error", message: health.reason };
      c.view.appendError(`Startup retry failed: ${health.reason}`);
      return;
    }
    try {
      c.client = createApiClient({
        baseUrl: connection.apiUrl,
        token: connection.token,
        ...(c.options.io.fetch === undefined ? {} : { fetch: c.options.io.fetch }),
      });
      c.project = discoverWorkspaceProject(c.sessionWorkspacePath, c.session);
      c.projectDiscoveryNotice = undefined;
      c.view.syncProjectPresentation();
      const reconnectedProject = await reconnectWorkspaceProject({
        workspacePath: c.sessionWorkspacePath,
        session: c.session,
        client: c.client,
        saveSession: saveWorkspaceSession,
        syncModelState: c.view.syncModelState,
        onDiscovered: (discovered) => {
          c.project = discovered;
          if (discovered.kind === "unavailable") c.projectDiscoveryNotice = discovered.reason;
          c.view.syncProjectPresentation();
        },
        onSessionAttached: (attachedSession) => {
          c.session = attachedSession;
        },
      });
      await this.applySuccessfulRetryHandoff(reconnectedProject.session, c.projectDiscoveryNotice);
      c.compactProjectNotice = c.project.kind === "attached" ? undefined : c.projectDiscoveryNotice;
    } catch {
      c.client = undefined;
      c.state.connection = { kind: "error", message: "Control Plane client could not be created" };
      c.view.appendError("Startup retry failed: Control Plane client could not be created");
    }
  };
}
