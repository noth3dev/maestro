import type { ParsedCommand } from "../../../commands/parser.js";
import { executeReadCommand } from "../../../commands/read-commands.js";
import { executeWriteCommand } from "../../../commands/write-commands.js";
import { loadWorkspaceSession, saveWorkspaceSession, selectWorkspaceGoal, selectWorkspaceModel } from "../../../session.js";
import { reconcileTuiSession } from "../../../recovery.js";
import { selectedCommandGoalId } from "../../../dashboard-state.js";
import type { TuiController } from "../../controller.js";

export async function handleQueryCommand(c: TuiController, parsed: ParsedCommand): Promise<void> {
  if (parsed.kind !== "command") throw new Error("Query handler requires a parsed command");
  const project = c.project;
  if (parsed.name === "goal" && parsed.action === "select") {
    const requestedGoalId = parsed.options["goal-id"];
    if (c.client === undefined || project.kind !== "attached") {
      c.view.appendWarning("Goal selection is unavailable until a workspace project is attached.");
    } else if (typeof requestedGoalId !== "string" || requestedGoalId.trim() === "") {
      c.view.appendWarning("Goal selection requires --goal-id.");
    } else {
      c.invalidateDashboardRefreshes();
      const selected = await c.client.getGoal(requestedGoalId, { projectId: project.projectId });
      if (selected.projectId !== project.projectId) throw new Error("Selected Goal is bound to another project");
      const current = await loadWorkspaceSession(c.sessionWorkspacePath);
      c.session = selectWorkspaceGoal(c.sessionWorkspacePath, current ?? c.session, selected.goalId);
      await saveWorkspaceSession(c.session);
      c.recovery = reconcileTuiSession(c.sessionWorkspacePath, c.session, { goalState: selected.state });
      c.view.appendSuccess(`Selected Goal: ${selected.goalId} · ${selected.state} · v${selected.version}`);
      void c.refreshDashboard();
    }
  } else if (parsed.name === "projects" && parsed.action === "list") {
    if (c.client === undefined) {
      c.view.appendWarning("Projects unavailable until the Control Plane is connected.");
    } else {
      const readResult = await executeReadCommand(
        { client: c.client, projectId: project.kind === "attached" ? project.projectId : "" },
        parsed,
      );
      c.view.append(`${readResult.title}: ${readResult.lines.join(" · ")}`);
    }
  } else if ((parsed.name === "models" || parsed.name === "model") && (parsed.action === undefined || parsed.action === "list")) {
    if (c.client === undefined) {
      const unavailableLabel = "Model catalog unavailable";
      c.view.appendWarning("Model catalog unavailable until the Control Plane is connected.");
      c.compactModelList = c.terminal.rows < 16 ? { identities: [], unavailableLabel } : undefined;
    } else {
      try {
        const models = await c.client.listModels();
        const identities = models.map((model) => `${model.identity.provider}/${model.identity.id}`);
        c.view.append(identities.length === 0 ? "No models are currently available." : `Models: ${identities.join(" · ")}`);
        c.compactModelList = c.terminal.rows < 16 ? { identities } : undefined;
      } catch (error) {
        const message = `Model catalog unavailable: ${error instanceof Error ? error.message : "request failed"}`;
        c.view.appendError(message);
        c.compactModelList = c.terminal.rows < 16 ? { identities: [], unavailableLabel: "Model catalog unavailable" } : undefined;
      }
    }
  } else if ((parsed.name === "models" || parsed.name === "model") && parsed.action === "use") {
    const requestedModel = parsed.options["model"];
    if (c.client === undefined) {
      c.view.appendWarning("Model selection is unavailable until the Control Plane is connected.");
    } else if (typeof requestedModel !== "string" || requestedModel.trim() === "") {
      c.view.appendWarning("Model selection requires --model provider/model (use /model list first).");
    } else {
      const models = await c.client.listModels();
      const selected = models.find((model) => `${model.identity.provider}/${model.identity.id}` === requestedModel);
      if (selected === undefined) {
        c.view.appendWarning(`Model is not available: ${requestedModel}`);
      } else if (c.session?.conversationId !== undefined) {
        c.view.appendWarning("The active conversation is bound to its model. Use /session new before selecting another model.");
      } else {
        c.session = selectWorkspaceModel(c.sessionWorkspacePath, c.session, requestedModel);
        await saveWorkspaceSession(c.session);
        c.state.model = requestedModel;
        c.view.appendSuccess(`Selected model: ${requestedModel}`);
      }
    }
  } else if (parsed.name === "conversation" && parsed.action === "cancel") {
    if (c.client === undefined || project.kind !== "attached") {
      c.view.appendWarning("Conversation cancellation is unavailable until a workspace project is attached.");
    } else {
      const requestedConversationId = parsed.options["conversation-id"];
      if (requestedConversationId === c.session?.conversationId) c.conversationTurnController?.abort();
      const goalId = selectedCommandGoalId(parsed.options["goal-id"], c.state.goal, c.session?.goalId);
      const cancelResult = await executeWriteCommand(
        {
          client: c.client,
          projectId: project.projectId,
          ...(goalId === undefined ? {} : { goalId }),
          confirm: c.confirm,
        },
        parsed,
      );
      c.view.append(`${cancelResult.title}: ${cancelResult.lines.join(" · ")}`);
    }
  } else {
    throw new Error(`Unhandled query command (dispatcher/handler routing mismatch): /${parsed.name}`);
  }
}
