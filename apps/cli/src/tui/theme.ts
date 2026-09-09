export type Paint = (text: string) => string;

export type TranscriptKind = "error" | "success" | "system" | "warning" | "text";
export interface TranscriptLine {
  kind: TranscriptKind;
  text: string;
}

// Warm Earth design-system tokens from docs/assets/design/design-system.html (dark theme).
// True-colour ANSI keeps the terminal palette visually aligned with the web UI when the
// terminal advertises support for it. Otherwise we use portable ANSI-16 colours.
type ColorMode = "none" | "ansi16" | "truecolor";

function colorMode(): ColorMode {
  if (Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR")) return "none";
  const colorTerm = process.env.COLORTERM?.toLowerCase();
  return colorTerm === "truecolor" || colorTerm === "24bit" ? "truecolor" : "ansi16";
}

const foreground = (hex: string, ansi16Code: number): Paint => {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (text) => {
    const mode = colorMode();
    if (mode === "none") return text;
    if (mode === "ansi16") return `\u001b[${ansi16Code}m${text}\u001b[39m`;
    return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[39m`;
  };
};

const terminalBackground: Paint = (text) => text;
const terminalForeground: Paint = (text) => text;
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
  (warm: string, modeTarget: string, ansi16Code: number): Paint =>
  (text) =>
    foreground(interpolateHex(warm, modeTarget, modeAccentProgress), ansi16Code)(text);

/** 0 is Maestro/Warm Earth; 1 is the Flashmob execution-profile blue accent. Intermediate values are rendered. */
export function setModeAccentProgress(progress: number): void {
  if (!Number.isFinite(progress)) throw new RangeError("Mode accent progress must be finite");
  modeAccentProgress = Math.max(0, Math.min(1, progress));
}

export function getModeAccentProgress(): number {
  return modeAccentProgress;
}

export const tuiTheme = {
  // The terminal owns its foreground and background. Body text is deliberately unpainted so
  // light and dark terminal themes both remain readable.
  page: terminalBackground,
  surface1: terminalBackground,
  surface2: terminalBackground,
  surface3: terminalBackground,
  text: terminalForeground,
  secondary: foreground("#a8a59c", 37),
  muted: foreground("#75726a", 90),
  dim: foreground("#5f5d57", 90),
  border: foreground("#2a2927", 90),
  borderStrong: foreground("#363431", 90),

  // Warm Earth accent -> Flashmob execution-profile blue accent. Semantic red/green states stay
  // red/green so a mode switch never hides an error or success condition.
  primary: animatedForeground("#c97855", "#6a9aba", 33),
  warning: animatedForeground("#d4a85a", "#6abaaa", 33),
  danger: foreground("#c86a58", 31),
  success: foreground("#7aba7a", 32),
  olive: foreground("#a8a06a", 33),
  teal: foreground("#6abaaa", 36),
  blue: foreground("#6a9aba", 34),

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

function transcriptPaint(kind: TranscriptKind): Paint {
  switch (kind) {
    case "error":
      return tuiTheme.danger;
    case "success":
      return tuiTheme.success;
    case "system":
      return tuiTheme.primary;
    case "warning":
      return tuiTheme.warning;
    case "text":
      return tuiTheme.text;
  }
}

export function paintTranscript(line: TranscriptLine, width: number): string;
export function paintTranscript(line: string, width: number): string;
export function paintTranscript(line: TranscriptLine | string, width: number): string;
export function paintTranscript(line: TranscriptLine | string, width: number): string {
  const semanticLine: TranscriptLine = typeof line === "string" ? { kind: "text", text: line } : line;
  const plain = fitPlain(`  ${semanticLine.text}`, width);
  return transcriptPaint(semanticLine.kind)(plain);
}
