import { fitPlain, tuiTheme } from "../theme.js";

export type AccountLoginProviderSelection = 0 | 1;

export const COMPACT_PROVIDER_LOGIN_MIN_HEIGHT = 8;

function compactLine(width: number, text: string, paint: (value: string) => string = tuiTheme.text): string {
  return paint(fitPlain(text, width));
}

export function renderProviderLoginDialog(
  width: number,
  selected: AccountLoginProviderSelection,
  state: "selecting" | "opening" | "waiting",
  authUrl?: string,
  compact = false,
): string[] {
  if (compact) {
    const selectedProvider = selected === 0 ? "ChatGPT Plus / Pro" : "Claude Pro / Max (unavailable)";
    const otherProvider = selected === 0 ? "  Claude Pro / Max (unavailable)" : "  ChatGPT Plus / Pro";
    if (state === "selecting") {
      return [
        compactLine(width, "Sign in to Maestro", tuiTheme.primary),
        compactLine(width, `› ${selectedProvider}`, tuiTheme.primary),
        compactLine(width, otherProvider),
        compactLine(width, "↑/↓ choose · Enter continue · Esc cancel", tuiTheme.dim),
      ];
    }
    if (state === "opening") {
      return [
        compactLine(width, "Sign in to Maestro", tuiTheme.primary),
        compactLine(width, "Opening sign-in page…", tuiTheme.dim),
        compactLine(width, "Esc cancel", tuiTheme.dim),
      ];
    }
    return [
      compactLine(width, "Sign in to Maestro", tuiTheme.primary),
      compactLine(width, "Finish in browser · Alt+C copy link", tuiTheme.dim),
      compactLine(width, "Esc cancel", tuiTheme.dim),
    ];
  }

  const title = tuiTheme.primary("  Sign in to Maestro");
  const openai = selected === 0 ? tuiTheme.primary("› ") : "  ";
  const anthropic = selected === 1 ? tuiTheme.primary("› ") : "  ";
  const lines = [
    title,
    "",
    `${openai}${tuiTheme.text("ChatGPT Plus / Pro")} ${tuiTheme.muted("· OpenAI Codex account")}`,
    `${anthropic}${tuiTheme.dim("Claude Pro / Max")} ${tuiTheme.warning("· unavailable: provider approval required")}`,
    "",
    state === "selecting"
      ? tuiTheme.dim("↑/↓ choose · Enter continue · Esc cancel")
      : state === "opening"
        ? tuiTheme.dim("Opening the provider sign-in page…")
        : tuiTheme.dim("Finish sign-in in your browser · Alt+C copy link · Esc cancels"),
    ...(state === "waiting" && authUrl !== undefined ? [tuiTheme.muted(`Link: ${authUrl}`)] : []),
  ];
  return lines.map((line) => (line.length > width ? line.slice(0, Math.max(0, width)) : line));
}
