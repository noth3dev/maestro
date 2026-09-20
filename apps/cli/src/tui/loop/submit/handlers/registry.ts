import type { ParsedCommand } from "../../../commands/parser.js";
import { executeReadCommand } from "../../../commands/read-commands.js";
import { dispatchInteractiveWriteCommand } from "../../../commands/interactive-dispatch.js";
import type { executeWriteCommand } from "../../../commands/write-commands.js";
import { resolveConfiguredModel } from "../../../entry-hydration.js";
import { selectedCommandGoalId } from "../../../dashboard-state.js";
import type { TuiController } from "../../controller.js";

export async function handleRegistryCommand(c: TuiController, parsed: ParsedCommand): Promise<void> {
  if (parsed.kind !== "command" || c.client === undefined) throw new Error("Registry handler requires a connected command");
  const project = c.project;
  if (project.kind !== "attached") throw new Error("Registry handler requires an attached project");
  const action = c.registry.find(parsed.name)?.actions.find((item) => item.name === parsed.action);
  const goalId = selectedCommandGoalId(parsed.options["goal-id"], c.state.goal, c.session?.goalId);
  if (action?.kind === "read") {
    const readResult = await executeReadCommand(
      { client: c.client, projectId: project.projectId, ...(goalId === undefined ? {} : { goalId }) },
      parsed,
    );
    c.view.append(`${readResult.title}: ${readResult.lines.join(" · ")}`);
  } else if (action !== undefined) {
    const writeContext = {
      client: c.client,
      projectId: project.projectId,
      ...(goalId === undefined ? {} : { goalId }),
      confirm: c.confirm,
    } as Parameters<typeof executeWriteCommand>[0];
    const selectedModel = resolveConfiguredModel(c.options.env.MAESTRO_MODEL, c.session?.model);
    if (selectedModel !== undefined) writeContext.model = selectedModel;
    c.invalidateDashboardRefreshes();
    const writeResult = await dispatchInteractiveWriteCommand(writeContext, parsed);
    c.pendingConfirmation = undefined;
    c.view.syncPendingDecisionState();
    c.view.append(`${writeResult.title}: ${writeResult.lines.join(" · ")}`);
    void c.refreshDashboard();
  } else {
    const definition = c.registry.find(parsed.name);
    c.view.append(
      definition === undefined
        ? `Unknown command: /${parsed.name}. Use /help for available commands.`
        : `Command /${parsed.name} requires an action: ${definition.actions.map((item) => item.name).join(", ")}`,
    );
  }
}
