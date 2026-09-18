import type { ParsedCommand } from "../../../commands/parser.js";
import { renderRecoveryBanner } from "../../../components/recovery-banner.js";
import { attachWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession, startNewConversationSession } from "../../../session.js";
import { reconcileTuiSession } from "../../../recovery.js";
import { discoverWorkspaceProject, discoverWorkspaceProjectFromControlPlane } from "../../../commands/read-commands.js";
import type { TuiController } from "../../controller.js";

export async function handleSessionCommand(c: TuiController, parsed: ParsedCommand): Promise<boolean> {
  if (parsed.kind !== "command" || parsed.name !== "session") throw new Error("Session handler requires a /session command");
  if (parsed.action === "retry") {
    await c.connectionFlow.retryConnection();
  } else if (parsed.action === "new") {
    c.resetConversationStream("session");
    c.draftedTaskContract = undefined;
    c.renderedDraftIdentity = undefined;
    c.session = startNewConversationSession(c.sessionWorkspacePath, c.session);
    await saveWorkspaceSession(c.session);
    c.recovery = reconcileTuiSession(c.sessionWorkspacePath, c.session);
    c.view.appendSuccess("New Concertmaster conversation started. Durable Goal state was preserved.");
  } else if (parsed.action === "attach") {
    c.resetConversationStream("session");
    c.draftedTaskContract = undefined;
    c.renderedDraftIdentity = undefined;
    const requestedProjectId = parsed.options["project-id"];
    const requestedProjectIndex = parsed.options["project-index"];
    const current = await loadWorkspaceSession(c.sessionWorkspacePath);
    if (typeof requestedProjectId === "string" && requestedProjectId.trim() !== "") {
      c.session = attachWorkspaceSession(c.sessionWorkspacePath, current, requestedProjectId);
      c.view.syncModelState();
      await saveWorkspaceSession(c.session);
    } else if (typeof requestedProjectIndex === "string" && requestedProjectIndex.trim() !== "") {
      if (c.client === undefined) {
        c.view.appendWarning("Project discovery is unavailable until the Control Plane is connected.");
        return true;
      }
      const index = Number(requestedProjectIndex);
      const projects = (await c.client.listProjects()).projects;
      if (!Number.isSafeInteger(index) || index < 1 || index > projects.length) {
        c.view.appendWarning(`Project index must be a number from 1 to ${projects.length}.`);
        return true;
      }
      c.session = attachWorkspaceSession(c.sessionWorkspacePath, current, projects[index - 1]!);
      c.view.syncModelState();
      await saveWorkspaceSession(c.session);
    } else if (current?.projectId !== undefined) {
      c.session = current;
      c.view.syncModelState();
    } else if (c.client !== undefined) {
      const discovered = await discoverWorkspaceProjectFromControlPlane({
        workspacePath: c.sessionWorkspacePath,
        session: current,
        client: c.client,
      });
      if (discovered.kind !== "attached") {
        c.view.appendWarning(discovered.reason);
        return true;
      }
      c.session = attachWorkspaceSession(c.sessionWorkspacePath, current, discovered.projectId);
      c.view.syncModelState();
      await saveWorkspaceSession(c.session);
    } else {
      c.view.appendWarning("Session attach requires a connected Control Plane or --project-id.");
      return true;
    }
    c.project = discoverWorkspaceProject(c.sessionWorkspacePath, c.session);
    c.projectDiscoveryNotice = undefined;
    c.compactProjectNotice = undefined;
    c.view.syncProjectPresentation();
    c.recovery = reconcileTuiSession(c.sessionWorkspacePath, c.session);
    c.view.append(renderRecoveryBanner(c.recovery, c.terminal.columns).join(" · "));
    void c.refreshDashboard();
    c.activitySync.restartActivity();
    const project = c.project;
    if (project.kind === "attached") {
      const generation = ++c.conversationHydrationGeneration;
      c.conversationHydration = c.activitySync.hydrateConversation(c.session?.conversationId, project.projectId, generation);
      void c.auth.offerAutomaticProviderSignIn();
    }
  } else if (parsed.action === "list") {
    const current = await loadWorkspaceSession(c.sessionWorkspacePath);
    c.view.append(
      current === undefined
        ? "Session: no saved workspace session"
        : renderRecoveryBanner(reconcileTuiSession(c.sessionWorkspacePath, current), c.terminal.columns).join(" · "),
    );
  } else {
    c.view.appendWarning(`Command: /session ${parsed.action ?? ""} (unknown session action)`.trim());
  }
  return false;
}
