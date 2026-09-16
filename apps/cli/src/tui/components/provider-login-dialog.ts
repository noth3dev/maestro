import { fitPlain, tuiTheme } from "../theme.js";

export type AccountLoginProviderSelection = 0 | 1;

export const COMPACT_PROVIDER_LOGIN_MIN_HEIGHT = 8;

function compactLine(width: number, text: string, paint: (value: string) => string = tuiTheme.text): string {
  return paint(fitPlain(text, width));
}

function wrapWords(text: string, width: number, indent = ""): string[] {
  if (width <= indent.length) return [fitPlain(indent, width)];
  const result: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (candidate.length <= width - indent.length) line = candidate;
    else if (line !== "") {
      result.push(`${indent}${line}`);
      line = word;
    } else {
      result.push(`${indent}${fitPlain(word, width - indent.length)}`);
      line = "";
    }
  }
  if (line !== "") result.push(`${indent}${line}`);
  return result;
}

function fullOptionLines(
  width: number,
  selected: boolean,
  name: string,
  detail: string,
  namePaint: (value: string) => string,
  detailPaint: (value: string) => string,
): string[] {
  const marker = selected ? "› " : "  ";
  const plainDetail = `· ${detail}`;
  if (`${marker}${name} ${plainDetail}`.length <= width) {
    return [`${selected ? tuiTheme.primary(marker) : marker}${namePaint(name)} ${detailPaint(plainDetail)}`];
  }

  const first = fitPlain(`${marker}${name}`, width);
  const detailLines = wrapWords(plainDetail, width, "  ");
  return [
    `${selected ? tuiTheme.primary(first.slice(0, marker.length)) : first.slice(0, marker.length)}${namePaint(first.slice(marker.length))}`,
    ...detailLines.map((line) => detailPaint(line)),
  ];
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

  const lines = [
    tuiTheme.primary(fitPlain("  Sign in to Maestro", width)),
    "",
    ...fullOptionLines(width, selected === 0, "ChatGPT Plus / Pro", "OpenAI Codex account", tuiTheme.text, tuiTheme.muted),
    ...fullOptionLines(
      width,
      selected === 1,
      "Claude Pro / Max",
      "unavailable: provider approval required",
      tuiTheme.dim,
      tuiTheme.warning,
    ),
    "",
    ...(state === "selecting"
      ? [tuiTheme.dim(fitPlain("↑/↓ choose · Enter continue · Esc cancel", width))]
      : state === "opening"
        ? [tuiTheme.dim(fitPlain("Opening the provider sign-in page…", width))]
        : wrapWords("Finish sign-in in your browser · Alt+C copy link · Esc cancels", width).map((line) => tuiTheme.dim(line))),
    ...(state === "waiting" && authUrl !== undefined ? [tuiTheme.muted(fitPlain(`Link: ${authUrl}`, width))] : []),
  ];
  return lines;
}
