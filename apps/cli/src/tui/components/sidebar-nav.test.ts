import { describe, expect, it, vi } from "vitest";
import {
  applySidebarNavAction,
  moveSidebarFocus,
  NAV_ROWS,
  resolveSidebarNavClick,
  showHome,
} from "./sidebar-nav.js";

describe("sidebar nav rows", () => {
  it("exposes only mapped read navigation", () => {
    expect(NAV_ROWS.map((row) => row.id)).toEqual(["home", "inbox", "channel", "evlog", "billing", "luthiery"]);
    for (const row of NAV_ROWS) expect(row.label.length).toBeGreaterThan(0);
  });
});

describe("moveSidebarFocus", () => {
  const rows = NAV_ROWS;

  it("starts at the first row and wraps around", () => {
    expect(moveSidebarFocus(undefined, 1, rows)).toBe("home");
    expect(moveSidebarFocus(undefined, -1, rows)).toBe("luthiery");
    expect(moveSidebarFocus("luthiery", 1, rows)).toBe("home");
    expect(moveSidebarFocus("home", -1, rows)).toBe("luthiery");
    expect(moveSidebarFocus("channel", 1, rows)).toBe("evlog");
    expect(moveSidebarFocus("channel", -1, rows)).toBe("inbox");
  });

  it("keeps unknown ids and recovers on empty lists", () => {
    expect(moveSidebarFocus("nope", 1, rows)).toBe("home");
    expect(moveSidebarFocus(undefined, 1, [])).toBeUndefined();
  });
});

describe("resolveSidebarNavClick", () => {
  const lines = ["──────────────────────────", " sidebar", " models", "  home", "  inbox", "  channel", "──────────────────────────"];

  it("maps label hits to row ids and ignores chrome", () => {
    expect(resolveSidebarNavClick(lines, 3, 3)).toBe("home");
    expect(resolveSidebarNavClick(lines, 4, 4)).toBe("inbox");
    expect(resolveSidebarNavClick(lines, 3, 5)).toBe("channel");
    expect(resolveSidebarNavClick(lines, 3, 0)).toBeUndefined();
    expect(resolveSidebarNavClick(lines, 3, 1)).toBeUndefined();
    expect(resolveSidebarNavClick(lines, 3, 6)).toBeUndefined();
    expect(resolveSidebarNavClick(lines, 3, -1)).toBeUndefined();
    expect(resolveSidebarNavClick(lines, 3, 99)).toBeUndefined();
  });
});

describe("sidebar nav actions", () => {
  function host() {
    return {
      submitter: { submit: vi.fn() },
      splash: { restore: vi.fn() },
      tui: { requestRender: vi.fn() },
      view: { append: vi.fn(), appendWarning: vi.fn(), render: vi.fn(), syncPendingDecisionState: vi.fn() },
    pendingConfirmation: undefined as undefined,
    state: { pendingDecisions: [] as Array<{ identity: string; tier: string; action: string; actor: string }> },
    compactReview: undefined as string | undefined,
    terminal: { columns: 120, rows: 30 },
    contentWidth: () => 120,
  };
}

  it("submits mapped commands without awaiting", () => {
    const h = host();
    applySidebarNavAction(h, "channel");
    expect(h.submitter.submit).toHaveBeenCalledWith("/channel list");
    applySidebarNavAction(h, "evlog");
    expect(h.submitter.submit).toHaveBeenCalledWith("/events list");
    applySidebarNavAction(h, "billing");
    expect(h.submitter.submit).toHaveBeenCalledWith("/billing get");
    applySidebarNavAction(h, "luthiery");
    expect(h.submitter.submit).toHaveBeenCalledWith("/luthiery list");
  });

  it("restores home through the splash", () => {
    const h = host();
    showHome(h);
    applySidebarNavAction(h, "home");
    expect(h.splash.restore).toHaveBeenCalledTimes(2);
    expect(h.tui.requestRender).toHaveBeenCalledWith(true);
  });

  it("ignores unknown ids", () => {
    const h = host();
    applySidebarNavAction(h, "nope");
    expect(h.submitter.submit).not.toHaveBeenCalled();
    expect(h.view.append).not.toHaveBeenCalled();
  });

  it("reveals the pending approval dialog instead of resolving it", () => {
    const h = host();
    const resolve = vi.fn();
    const pending = { ...h, pendingConfirmation: { summary: { action: "deploy", target: "staging", effect: "release", expiresAt: "2030-01-01" }, resolve } };
    applySidebarNavAction(pending, "inbox");
    expect(resolve).not.toHaveBeenCalled();
    expect(h.view.append).toHaveBeenCalledOnce();
    expect(String(h.view.append.mock.calls[0]![0])).toContain("Approval required");
  });

  it("lists pending decisions when no confirmation is open", () => {
    const h = host();
    const pending = {
      ...h,
      state: { pendingDecisions: [{ identity: "effect-1", tier: "You", action: "deploy release", actor: "worker-1" }] },
    };
    applySidebarNavAction(pending, "inbox");
    expect(h.view.append).toHaveBeenCalledOnce();
    expect(String(h.view.append.mock.calls[0]![0])).toContain("deploy release");
  });
});
