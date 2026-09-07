import { tuiTheme } from "../theme.js";

export type AccountLoginProviderSelection = 0 | 1;

export function renderProviderLoginDialog(width: number, selected: AccountLoginProviderSelection, state: "selecting" | "opening" | "waiting"): string[] {
  const title = tuiTheme.primary("  Sign in to Maestro");
  const openai = selected === 0 ? tuiTheme.primary("› ") : "  ";
  const anthropic = selected === 1 ? tuiTheme.primary("› ") : "  ";
  const lines = [
    title,
    "",
    `${openai}${tuiTheme.text("ChatGPT Plus / Pro")} ${tuiTheme.muted("· OpenAI Codex account")}`,
    `${anthropic}${tuiTheme.dim("Claude Pro / Max")} ${tuiTheme.warning("· unavailable: provider approval required")}`,
    "",
    state === "selecting" ? tuiTheme.dim("↑/↓ choose · Enter continue · Esc cancel") : state === "opening" ? tuiTheme.dim("Opening the provider sign-in page…") : tuiTheme.dim("Finish sign-in in your browser · Esc cancels"),
  ];
  return lines.map((line) => line.length > width ? line.slice(0, Math.max(0, width)) : line);
}
