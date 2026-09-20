import { parseInput } from "../../commands/parser.js";
import {
  approvalPendingAcknowledgement,
  compactHelpAcknowledgement,
  shouldBlockConcurrentTurnSubmit,
  shouldBlockPendingConfirmationSubmit,
  shouldBlockProviderLoginInFlightSubmit,
  shouldIgnoreEmptySubmit,
} from "../../entry-helpers.js";
import { dispatchCommandPaletteInput } from "../../commands/palette.js";
import type { TuiController } from "../controller.js";
import { handleShellCommand } from "./handlers/shell.js";
import { handleSystemCommand } from "./handlers/system.js";
import { handleSessionCommand } from "./handlers/session.js";
import { handleQueryCommand } from "./handlers/queries.js";
import { handleRegistryCommand } from "./handlers/registry.js";
import { handleNaturalLanguageTurn } from "./handlers/turn.js";

export class SubmitDispatcher {
  constructor(private c: TuiController) {}

  openReadView = (viewId: string, text: string): void => {
    const c = this.c;
    const generation = c.view.beginMainPageLoading(viewId);
    void (async () => {
      try {
        const parsed = parseInput(text);
        if (parsed.kind !== "command") throw new Error("Sidebar destination is not a command");
        await handleRegistryCommand(c, parsed, { readViewId: viewId, readViewGeneration: generation });
      } catch (error) {
        c.view.setMainPageError(viewId, error instanceof Error ? error.message : "Unable to load destination", generation);
      }
    })();
  };

  submit = async (text: string): Promise<void> => {
    const c = this.c;
    if (shouldIgnoreEmptySubmit(text, c.pendingProviderLogin)) return;
    if (shouldBlockProviderLoginInFlightSubmit(text, c.providerLoginInFlight)) {
      c.editor.setText(text);
      c.view.appendWarning("Provider login in progress · please wait");
      c.view.render();
      return;
    }
    if (shouldBlockPendingConfirmationSubmit(text, c.pendingConfirmation !== undefined)) {
      c.editor.setText(text);
      c.view.appendWarning(approvalPendingAcknowledgement(c.contentWidth()));
      c.view.render();
      return;
    }
    if (shouldBlockConcurrentTurnSubmit(text, c.state.working === true, c.conversationTurnController, c.naturalSubmitInFlight)) {
      c.editor.setText(text);
      c.view.appendWarning("Turn in progress · Esc to stop");
      c.view.render();
      return;
    }
    if (text.trim() !== "") c.splash.dismiss();
    if (c.pendingProviderLogin !== undefined) {
      await c.auth.submitProviderLogin(text);
      return;
    }
    let ownsNaturalSubmit = false;
    const turnState: { turnGeneration?: number } = {};
    try {
      const parsed = parseInput(text);
      if (parsed.kind === "natural-language") {
        c.naturalSubmitInFlight = true;
        ownsNaturalSubmit = true;
      }
      if (
        parsed.kind === "command" &&
        parsed.action === undefined &&
        Object.keys(parsed.options).length === 0 &&
        (parsed.name === "clear" || parsed.name === "exit" || parsed.name === "quit" || parsed.name === "version" || parsed.name === "copy")
      ) {
        await handleShellCommand(c, parsed);
      } else if (parsed.kind === "command" && parsed.name === "help") {
        c.compactHelp = c.terminal.rows < 16 ? compactHelpAcknowledgement(c.contentWidth()) : undefined;
        dispatchCommandPaletteInput("help", c.view.append, parsed.action);
      } else if (
        parsed.kind === "command" &&
        ((parsed.name === "login" &&
          (parsed.action === undefined ||
            parsed.action === "openai-codex" ||
            parsed.action === "openai" ||
            parsed.action === "anthropic")) ||
          (parsed.name === "logout" && (parsed.action === "openai-codex" || parsed.action === "openai" || parsed.action === "anthropic")) ||
          (parsed.name === "flashmob" && (parsed.action === undefined || parsed.action === "toggle")) ||
          (parsed.name === "mode" &&
            (parsed.action === undefined ||
              parsed.action === "list" ||
              parsed.action === "flashmob" ||
              parsed.action === "maestro" ||
              parsed.action === "standard")))
      ) {
        await handleSystemCommand(c, parsed);
      } else if (parsed.kind === "command" && parsed.name === "session") {
        if (await handleSessionCommand(c, parsed)) return;
      } else if (
        parsed.kind === "command" &&
        ((parsed.name === "goal" && parsed.action === "select") ||
          (parsed.name === "projects" && parsed.action === "list") ||
          ((parsed.name === "models" || parsed.name === "model") &&
            (parsed.action === undefined || parsed.action === "list" || parsed.action === "use")) ||
          (parsed.name === "conversation" && parsed.action === "cancel"))
      ) {
        await handleQueryCommand(c, parsed);
      } else if (parsed.kind === "command" && c.client !== undefined && c.project.kind === "attached") {
        await handleRegistryCommand(c, parsed);
      } else if (parsed.kind === "command") {
        c.view.append(
          `Command: /${parsed.name}${parsed.action === undefined ? "" : ` ${parsed.action}`} (unavailable until a workspace project is attached)`,
        );
      } else {
        if (await handleNaturalLanguageTurn(c, text, turnState)) return;
      }
    } catch (error) {
      if (turnState.turnGeneration === undefined || c.conversationTurnBoundary.isCurrent(turnState.turnGeneration))
        c.view.appendError(`Input error: ${error instanceof Error ? error.message : "invalid input"}`);
    } finally {
      if (ownsNaturalSubmit) c.naturalSubmitInFlight = false;
    }
    c.editor.addToHistory(text);
  };
}
