import type { Component } from "@earendil-works/pi-tui";
import type { AccountLoginProviderSelection } from "./provider-login-dialog.js";
import { createClickRegion } from "./mouse.js";

export type ProviderLoginClickAction =
  | { kind: "select"; selection: AccountLoginProviderSelection }
  | { kind: "cancel" }
  | { kind: "continue" };

export interface ProviderLoginClickHost {
  accountLoginSelection: AccountLoginProviderSelection | undefined;
  readonly view: { render(): void };
  readonly auth: {
    cancelAccountLogin(): void;
    startAccountLogin(): Promise<void>;
  };
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

// Full option labels from renderProviderLoginDialog. The resolver anchors on
// these exact labels and returns undefined when truncation removes them, so a
// click can never select an option the operator cannot read.
const CHATGPT_LABEL = "ChatGPT Plus / Pro";
const CLAUDE_LABEL = "Claude Pro / Max";

function optionAtRow(text: string): AccountLoginProviderSelection | undefined {
  if (text.includes(CHATGPT_LABEL)) return 0;
  if (text.includes(CLAUDE_LABEL)) return 1;
  return undefined;
}

/**
 * Map a click in rendered provider-login lines to an option selection.
 * Only a dialog offering keyboard selection is clickable: the resolver
 * requires the `↑/↓ choose` hint row, so opening/waiting layouts (which
 * still render the option blocks) never map. Full layouts use owning-block
 * ranges so wrapped detail lines still select their option; compact layouts
 * use fixed rows with label checks. Anything unmapped (title, blank, hint,
 * truncated labels, out-of-range coordinates) returns undefined so the click
 * stays a no-op.
 */
export function resolveProviderLoginClick(
  lines: readonly string[],
  x: number,
  y: number,
  compact: boolean,
): AccountLoginProviderSelection | undefined {
  if (!Number.isInteger(y) || y < 0 || y >= lines.length) return undefined;
  if (!Number.isInteger(x) || x < 0) return undefined;
  const rows = lines.map(stripAnsi);
  if (rows.findIndex((row) => row.includes("↑/↓ choose")) === -1) return undefined;
  if (compact) {
    if (lines.length !== 4) return undefined;
    if (y !== 1 && y !== 2) return undefined;
    return optionAtRow(rows[y] ?? "");
  }
  const chatRow = rows.findIndex((row) => row.includes(CHATGPT_LABEL));
  const claudeRow = rows.findIndex((row) => row.includes(CLAUDE_LABEL));
  if (chatRow === -1 || claudeRow === -1 || claudeRow <= chatRow) return undefined;
  if (y >= chatRow && y < claudeRow) return 0;
  const hintRow = rows.findIndex((row) => row.includes("↑/↓ choose"));
  const end = hintRow === -1 ? rows.length : hintRow;
  if (y >= claudeRow && y < end) return 1;
  return undefined;
}

/**
 * Apply one provider-login action. The selecting-state keyboard branch in
 * lifecycle.ts delegates here, so click-select and key-select stay identical.
 * Clicking only ever selects; Enter still confirms and starts the flow.
 */
export function applyProviderLoginAction(host: ProviderLoginClickHost, action: ProviderLoginClickAction): boolean {
  switch (action.kind) {
    case "select": {
      if (host.accountLoginSelection === undefined) return false;
      if (host.accountLoginSelection === action.selection) return true;
      host.accountLoginSelection = action.selection;
      host.view.render();
      return true;
    }
    case "cancel": {
      if (host.accountLoginSelection === undefined) return false;
      host.auth.cancelAccountLogin();
      return true;
    }
    case "continue": {
      if (host.accountLoginSelection === undefined) return false;
      void host.auth.startAccountLogin();
      return true;
    }
  }
}

export function createProviderLoginClickRegion(options: {
  lines: (width: number) => readonly string[];
  isCompact: () => boolean;
  onSelect: (selection: AccountLoginProviderSelection) => void;
}): Component {
  return createClickRegion({
    lines: options.lines,
    resolve: (lines, x, y) => resolveProviderLoginClick(lines, x, y, options.isCompact()),
    onAction: options.onSelect,
  });
}
