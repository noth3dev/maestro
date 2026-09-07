export type Paint = (text: string) => string;

// Warm Earth design-system tokens from docs/assets/design/design-system.html (dark theme).
// True-colour ANSI keeps the terminal palette visually aligned with the web UI.
const foreground = (hex: string): Paint => {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (text) => `\u001b[38;2;${red};${green};${blue}m${text}\u001b[39m`;
};

const terminalBackground: Paint = (text) => text;
let modeAccentProgress = 0;

function interpolateHex(from: string, to: string, progress: number): string {
  const start = from.replace("#", "");
  const end = to.replace("#", "");
  const channel = (offset: number): string =>
    Math.round(
      Number.parseInt(start.slice(offset, offset + 2), 16) +
        (Number.parseInt(end.slice(offset, offset + 2), 16) - Number.parseInt(start.slice(offset, offset + 2), 16)) * progress,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

const animatedForeground =
  (warm: string, modeTarget: string): Paint =>
  (text) =>
    foreground(interpolateHex(warm, modeTarget, modeAccentProgress))(text);

/** 0 is Maestro/Warm Earth; 1 is the Flashmob execution-profile accent. Intermediate values are rendered. */
export function setModeAccentProgress(progress: number): void {
  if (!Number.isFinite(progress)) throw new RangeError("Mode accent progress must be finite");
  modeAccentProgress = Math.max(0, Math.min(1, progress));
}

export function getModeAccentProgress(): number {
  return modeAccentProgress;
}

export const tuiTheme = {
  // --bg-page / --surface-* / --text-*
  page: terminalBackground,
  surface1: terminalBackground,
  surface2: terminalBackground,
  surface3: terminalBackground,
  text: foreground("#ede9e2"),
  secondary: foreground("#a8a59c"),
  muted: foreground("#75726a"),
  dim: foreground("#5f5d57"),
  border: foreground("#2a2927"),
  borderStrong: foreground("#363431"),

  // Warm Earth accent -> Flashmob execution-profile blue accent. Semantic red/green states stay
  // red/green so a mode switch never hides an error or success condition.
  primary: animatedForeground("#c97855", "#6a9aba"),
  warning: animatedForeground("#d4a85a", "#6abaaa"),
  danger: foreground("#c86a58"),
  success: foreground("#7aba7a"),
  olive: foreground("#a8a06a"),
  teal: foreground("#6abaaa"),
  blue: foreground("#6a9aba"),

  // The terminal owns its background. These are identity paints by design.
  inputSurface: terminalBackground,
  autocompleteSurface: terminalBackground,
};

export function fitPlain(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function frameLine(content: string, width: number, paint: Paint = tuiTheme.muted): string {
  if (width < 2) return fitPlain(content, width);
  const innerWidth = width - 2;
  return `${tuiTheme.border("│")}${paint(fitPlain(content, innerWidth).padEnd(innerWidth))}${tuiTheme.border("│")}`;
}

export function frameRule(width: number, top = false): string {
  if (width <= 0) return "";
  if (width === 1) return tuiTheme.border(top ? "╭" : "╰");
  return tuiTheme.border(`${top ? "╭" : "╰"}${"─".repeat(Math.max(0, width - 2))}${top ? "╮" : "╯"}`);
}

export function paintTranscript(line: string, width: number): string {
  const plain = fitPlain(`  ${line}`, width);
  if (line.startsWith("Maestro [")) return tuiTheme.primary(plain);
  if (line.startsWith("Input error") || line.includes(" failed") || line.includes(" unavailable")) return tuiTheme.danger(plain);
  if (line.includes("connected") || line.startsWith("Selected Goal:")) return tuiTheme.success(plain);
  if (line.startsWith("Activity stream reconnecting")) return tuiTheme.warning(plain);
  return tuiTheme.text(plain);
}
