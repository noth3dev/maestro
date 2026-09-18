import type { ParsedCommand } from "../../../commands/parser.js";
import { COMPACT_PROVIDER_LOGIN_MIN_HEIGHT } from "../../../components/provider-login-dialog.js";
import type { TuiController } from "../../controller.js";

export async function handleSystemCommand(c: TuiController, parsed: ParsedCommand): Promise<void> {
  if (parsed.kind !== "command") throw new Error("System command handler requires a parsed command");
  if (parsed.name === "login" && parsed.action === undefined) {
    if (c.terminal.rows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT) {
      c.view.appendWarning(`Provider sign-in chooser needs at least ${COMPACT_PROVIDER_LOGIN_MIN_HEIGHT} terminal rows.`);
    } else {
      c.loginInteractionGeneration += 1;
      c.accountLoginSelection = 0;
      c.accountLoginState = "selecting";
      c.editor.hidden = true;
      c.editor.setText("");
      c.view.render();
    }
  } else if (parsed.name === "login" && parsed.action === "openai-codex") {
    if (c.terminal.rows < COMPACT_PROVIDER_LOGIN_MIN_HEIGHT) {
      c.view.appendWarning(`Provider sign-in chooser needs at least ${COMPACT_PROVIDER_LOGIN_MIN_HEIGHT} terminal rows.`);
    } else {
      c.loginInteractionGeneration += 1;
      c.accountLoginSelection = 0;
      c.accountLoginState = "selecting";
      c.editor.hidden = true;
      c.editor.setText("");
      c.view.render();
      void c.auth.startAccountLogin();
    }
  } else if (parsed.name === "login" && (parsed.action === "openai" || parsed.action === "anthropic")) {
    if (c.client === undefined) {
      c.view.appendWarning("Provider login is unavailable until the Control Plane is connected.");
    } else {
      c.loginInteractionGeneration += 1;
      c.pendingProviderLogin = parsed.action;
      c.editor.hidden = true;
      c.editor.setText("");
      c.view.append(`Enter the ${parsed.action} API key and press Enter. Input is hidden and never saved to session history.`);
      c.view.render();
    }
  } else if (parsed.name === "logout" && parsed.action === "openai-codex") {
    if (c.client === undefined) c.view.appendWarning("Account logout is unavailable until the Control Plane is connected.");
    else {
      c.invalidateDashboardRefreshes();
      await c.client.logoutAccount();
      c.view.appendSuccess("ChatGPT account signed out; its model bindings were revoked.");
      void c.refreshDashboard();
    }
  } else if (parsed.name === "logout" && (parsed.action === "openai" || parsed.action === "anthropic")) {
    if (c.client === undefined) c.view.appendWarning("Provider logout is unavailable until the Control Plane is connected.");
    else {
      await c.client.logoutProvider(parsed.action);
      c.view.appendSuccess(`Provider credential revoked: ${parsed.action}.`);
    }
  } else if (parsed.name === "flashmob" && (parsed.action === undefined || parsed.action === "toggle")) {
    await c.view.animateFlashmobMode(!c.flashmobMode);
  } else if (parsed.name === "mode" && (parsed.action === undefined || parsed.action === "list")) {
    c.view.append(`Mode: ${c.flashmobMode ? "flashmob" : "maestro"} · use /mode flashmob, /mode maestro, or /flashmob to toggle`);
  } else if (parsed.name === "mode" && parsed.action === "flashmob") {
    await c.view.animateFlashmobMode(true);
  } else if (parsed.name === "mode" && (parsed.action === "maestro" || parsed.action === "standard")) {
    await c.view.animateFlashmobMode(false);
  } else {
    throw new Error(`Unhandled system command (dispatcher/handler routing mismatch): /${parsed.name}`);
  }
}
