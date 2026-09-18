import { afterEach, describe, expect, it, vi } from "vitest";
import { Text, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { renderProviderLoginDialog } from "./provider-login-dialog.js";
import {
  applyProviderLoginAction,
  createProviderLoginClickRegion,
  resolveProviderLoginClick,
  type ProviderLoginClickHost,
} from "./provider-login-click.js";
import { sendClick, StubTerminal } from "./stub-terminal.js";

function rowWhere(lines: readonly string[], needle: string): number {
  return lines.findIndex((line) => line.includes(needle));
}

function fakeHost(selection: 0 | 1 | undefined): ProviderLoginClickHost & { rendered: number } {
  let rendered = 0;
  return {
    accountLoginSelection: selection,
    view: {
      render: () => {
        rendered += 1;
      },
    },
    auth: { cancelAccountLogin: vi.fn(), startAccountLogin: vi.fn() },
    get rendered() {
      return rendered;
    },
  };
}

describe("provider login click mapping", () => {
  it("maps compact rows to the labeled option", () => {
    for (const selection of [0, 1] as const) {
      const lines = renderProviderLoginDialog(80, selection, "selecting", undefined, true);
      expect(lines.length).toBe(4);
      expect(resolveProviderLoginClick(lines, 3, 1, true)).toBe(lines[1]!.includes("ChatGPT Plus / Pro") ? 0 : 1);
      expect(resolveProviderLoginClick(lines, 3, 2, true)).toBe(lines[2]!.includes("ChatGPT Plus / Pro") ? 0 : 1);
      expect(resolveProviderLoginClick(lines, 3, 0, true)).toBeUndefined();
      expect(resolveProviderLoginClick(lines, 3, 3, true)).toBeUndefined();
    }
  });

  it("maps full-layout option blocks including wrapped detail lines", () => {
    const lines = renderProviderLoginDialog(40, 0, "selecting", undefined, false);
    const chatRow = rowWhere(lines, "ChatGPT Plus / Pro");
    const claudeRow = rowWhere(lines, "Claude Pro / Max");
    const hintRow = rowWhere(lines, "↑/↓ choose");
    expect(chatRow).toBeGreaterThanOrEqual(0);
    expect(claudeRow).toBeGreaterThan(chatRow);
    expect(hintRow).toBeGreaterThan(claudeRow);
    expect(resolveProviderLoginClick(lines, 3, chatRow, false)).toBe(0);
    expect(resolveProviderLoginClick(lines, 3, chatRow + 1, false)).toBe(0);
    expect(resolveProviderLoginClick(lines, 3, claudeRow, false)).toBe(1);
    expect(resolveProviderLoginClick(lines, 3, hintRow, false)).toBeUndefined();
    expect(resolveProviderLoginClick(lines, 3, 0, false)).toBeUndefined();
  });

  it("ignores opening and waiting layouts with either geometry flag", () => {
    for (const state of ["opening", "waiting"] as const) {
      const full = renderProviderLoginDialog(100, 0, state, "https://example.test/login", false);
      const compact = renderProviderLoginDialog(100, 0, state, "https://example.test/login", true);
      for (const lines of [full, compact]) {
        for (const flag of [false, true]) {
          for (let y = 0; y < lines.length; y += 1) {
            expect(resolveProviderLoginClick(lines, 3, y, flag)).toBeUndefined();
          }
        }
      }
    }
  });

  it("returns undefined when truncation removes an option label", () => {
    const lines = renderProviderLoginDialog(19, 0, "selecting", undefined, false);
    expect(rowWhere(lines, "ChatGPT Plus / Pro")).toBe(-1);
    expect(rowWhere(lines, "Claude Pro / Max")).toBeGreaterThanOrEqual(0);
    for (let y = 0; y < lines.length; y += 1) {
      expect(resolveProviderLoginClick(lines, 2, y, false)).toBeUndefined();
    }
  });

  it("rejects out-of-range coordinates", () => {
    const lines = renderProviderLoginDialog(100, 0, "selecting", undefined, false);
    expect(resolveProviderLoginClick(lines, 3, -1, false)).toBeUndefined();
    expect(resolveProviderLoginClick(lines, 3, lines.length, false)).toBeUndefined();
    expect(resolveProviderLoginClick(lines, -1, 2, false)).toBeUndefined();
  });
});

describe("provider login shared actions", () => {
  it("selects the clicked option and re-renders", () => {
    const host = fakeHost(0);
    expect(applyProviderLoginAction(host, { kind: "select", selection: 1 })).toBe(true);
    expect(host.accountLoginSelection).toBe(1);
    expect(host.rendered).toBe(1);
  });

  it("treats selecting the current option as a handled no-op", () => {
    const host = fakeHost(0);
    expect(applyProviderLoginAction(host, { kind: "select", selection: 0 })).toBe(true);
    expect(host.rendered).toBe(0);
  });

  it("cancels and continues through the auth flow", () => {
    const host = fakeHost(0);
    expect(applyProviderLoginAction(host, { kind: "cancel" })).toBe(true);
    expect(host.auth.cancelAccountLogin).toHaveBeenCalledOnce();
    expect(applyProviderLoginAction(host, { kind: "continue" })).toBe(true);
    expect(host.auth.startAccountLogin).toHaveBeenCalledOnce();
  });

  it("does nothing without an active selection", () => {
    const host = fakeHost(undefined);
    expect(applyProviderLoginAction(host, { kind: "select", selection: 0 })).toBe(false);
    expect(applyProviderLoginAction(host, { kind: "cancel" })).toBe(false);
    expect(applyProviderLoginAction(host, { kind: "continue" })).toBe(false);
    expect(host.auth.cancelAccountLogin).not.toHaveBeenCalled();
    expect(host.auth.startAccountLogin).not.toHaveBeenCalled();
  });
});

describe("provider login click region", () => {
  const screens: TuiAltScreen[] = [];
  afterEach(() => {
    for (const screen of screens) screen.stop();
    screens.length = 0;
  });

  it("maps clicks to region-local rows below a non-empty banner", () => {
    const terminal = new StubTerminal();
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    const selected: Array<0 | 1> = [];
    const region = createProviderLoginClickRegion({
      lines: (width) => renderProviderLoginDialog(width, 0, "selecting", undefined, false),
      isCompact: () => false,
      onSelect: (selection) => selected.push(selection),
    });
    tui.setLayoutRoot(new VStack([{ component: new Text("banner"), basis: "auto" }, { component: region, basis: "auto" }]));
    tui.start();
    tui.renderNow(true);

    // Text pads single-line content, so measure the banner height instead of
    // assuming one row; the ChatGPT option label is region-local row 2.
    const bannerHeight = new Text("banner").render(terminal.columns).length;
    const optionRow = bannerHeight + 2 + 1;
    sendClick(terminal, 5, optionRow);
    expect(selected).toEqual([0]);

    // Clicking the banner itself selects nothing.
    sendClick(terminal, 3, 2);
    expect(selected).toEqual([0]);
  });
});
