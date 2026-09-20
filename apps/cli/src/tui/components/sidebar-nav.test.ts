import { describe, expect, it, vi } from "vitest";
import {
  activateSidebarRow,
  applySidebarNavAction,
  moveSidebarFocus,
  NAV_ROWS,
  resolveSidebarGoalClick,
  resolveSidebarNavClick,
  showHome,
  sidebarFocusRows,
} from "./sidebar-nav.js";
import { renderGoalSection, renderNavSection, renderSidebar, SIDEBAR_WIDTH } from "./sidebar.js";

// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

describe("sidebar nav rows", () => {
  it("exposes only mapped read navigation", () => {
    expect(NAV_ROWS.map((row) => row.id)).toEqual(["home", "inbox", "channel", "evlog", "billing", "luthiery"]);
    expect(NAV_ROWS.map((row) => row.label)).toEqual(["search", "inbox", "channel", "evidence log", "billing", "luthiery"]);
    for (const row of NAV_ROWS) expect(row.label.length).toBeGreaterThan(0);
  });

  it("renders exactly six selectable nav rows", () => {
    expect(NAV_ROWS.length).toBe(6);
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
  const lines = ["──────────────────────────", " sidebar", " models", "  search", "  inbox", "  channel", "──────────────────────────"];

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

  it("never matches a channel name containing a nav label", () => {
    expect(resolveSidebarNavClick(["  #research (5)"], 3, 0)).toBeUndefined();
    expect(resolveSidebarNavClick(["  billing disputes"], 3, 0)).toBe("billing");
  });

  it("ignores truncated labels instead of guessing", () => {
    expect(resolveSidebarNavClick(["  searc"], 3, 0)).toBeUndefined();
    expect(resolveSidebarNavClick(["  evidence lo"], 3, 0)).toBeUndefined();
  });

  it("treats the divider column as chrome", () => {
    expect(resolveSidebarNavClick([`  search${" ".repeat(17)}┃`], 25, 0)).toBeUndefined();
    expect(resolveSidebarNavClick([`  search${" ".repeat(17)}┃`], 3, 0)).toBe("home");
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
    sidebarSelection: undefined as string | undefined,
    terminal: { columns: 120, rows: 30 },
    contentWidth: () => 120,
    sidebarGoals: [] as Array<{ goalId: string }>,
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

  it("updates the current nav marker without taking focus", () => {
    const h = host();
    expect(h.sidebarSelection).toBeUndefined();
    applySidebarNavAction(h, "channel");
    expect(h.sidebarSelection).toBe("channel");
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

describe("sidebar row activation", () => {
  const goals = [
    { goalId: "11111111-2222-4333-8444-555555555555" },
    { goalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
  ];

  function host() {
    return {
      submitter: { submit: vi.fn() },
      splash: { restore: vi.fn() },
      tui: { requestRender: vi.fn() },
      view: { append: vi.fn(), appendWarning: vi.fn(), render: vi.fn(), syncPendingDecisionState: vi.fn() },
      pendingConfirmation: undefined as undefined,
      state: { pendingDecisions: [] as Array<{ identity: string; tier: string; action: string; actor: string }> },
      compactReview: undefined as string | undefined,
      sidebarSelection: undefined as string | undefined,
      terminal: { columns: 120, rows: 30 },
      contentWidth: () => 120,
      sidebarGoals: goals,
    };
  }

  it("submits goal select for a cached goal id", () => {
    const h = host();
    activateSidebarRow(h, goals[0]!.goalId);
    expect(h.submitter.submit).toHaveBeenCalledWith(`/goal select --goal-id ${goals[0]!.goalId}`);
  });

  it("still routes nav ids through the nav actions", () => {
    const h = host();
    activateSidebarRow(h, "channel");
    expect(h.submitter.submit).toHaveBeenCalledWith("/channel list");
  });

  it("ignores ids that are neither nav rows nor cached goals", () => {
    const h = host();
    activateSidebarRow(h, "99999999-2222-4333-8444-555555555555");
    expect(h.submitter.submit).not.toHaveBeenCalled();
    expect(h.view.append).not.toHaveBeenCalled();
  });
});

describe("sidebar focus rows", () => {
  it("combines nav ids with cached goal ids", () => {
    expect(sidebarFocusRows([]).map((row) => row.id)).toEqual(["home", "inbox", "channel", "evlog", "billing", "luthiery"]);
    expect(sidebarFocusRows([{ goalId: "goal-1" }, { goalId: "goal-2" }]).map((row) => row.id)).toEqual([
      "home",
      "inbox",
      "channel",
      "evlog",
      "billing",
      "luthiery",
      "goal-1",
      "goal-2",
    ]);
  });

  it("caps goals at the rendered limit", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ goalId: `goal-${index}` }));
    expect(sidebarFocusRows(many).length).toBe(6 + 5);
  });

  it("orders channel rows between nav and goal rows with a shared cap", () => {
    const ids = sidebarFocusRows([{ goalId: "goal-1" }], ["channel:department:engineering", "channel:organization:general"]).map(
      (row) => row.id,
    );
    expect(ids.slice(0, 6)).toEqual(["home", "inbox", "channel", "evlog", "billing", "luthiery"]);
    expect(ids.slice(6, 8)).toEqual(["channel:department:engineering", "channel:organization:general"]);
    expect(ids[8]).toBe("goal-1");
    const many = Array.from({ length: 12 }, (_, index) => `channel:department:dept-${index}`);
    expect(sidebarFocusRows([], many).length).toBe(6 + 8);
  });
});

describe("resolveSidebarGoalClick", () => {
  const goals = [
    { goalId: "11111111-2222-4333-8444-555555555555", state: "running" },
    { goalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", state: "paused" },
  ];

  function lines() {
    const goalSection = renderGoalSection(goals, undefined, undefined);
    return renderSidebar(SIDEBAR_WIDTH, [renderNavSection(NAV_ROWS, undefined), goalSection!]);
  }

  function rowIndex(rendered: readonly string[], fragment: string): number {
    return rendered.findIndex((line) => stripAnsi(line).includes(fragment));
  }

  it("maps goal rows to ids and ignores nav rows and chrome", () => {
    const rendered = lines();
    expect(resolveSidebarGoalClick(rendered, goals, 3, rowIndex(rendered, "11111111"))).toBe(goals[0]!.goalId);
    expect(resolveSidebarGoalClick(rendered, goals, 3, rowIndex(rendered, "aaaaaaaa"))).toBe(goals[1]!.goalId);
    expect(resolveSidebarGoalClick(rendered, goals, 3, rowIndex(rendered, "search"))).toBeUndefined();
    expect(resolveSidebarGoalClick(rendered, goals, 3, 0)).toBeUndefined();
    expect(resolveSidebarGoalClick(rendered, goals, 3, -1)).toBeUndefined();
    expect(resolveSidebarGoalClick(rendered, goals, 3, rendered.length)).toBeUndefined();
  });

  it("ignores clicks beyond the rendered text", () => {
    const rendered = lines();
    expect(resolveSidebarGoalClick(rendered, goals, 99, rowIndex(rendered, "11111111"))).toBeUndefined();
  });

  it("never matches a full goal id rendered outside the goals block", () => {
    const goalSection = renderGoalSection(goals, undefined, undefined);
    const rendered = renderSidebar(SIDEBAR_WIDTH, [
      { title: "status", rows: [{ label: "goal", value: goals[0]!.goalId }] },
      renderNavSection(NAV_ROWS, undefined),
      goalSection!,
    ]);
    expect(resolveSidebarGoalClick(rendered, goals, 3, rowIndex(rendered, "status") + 1)).toBeUndefined();
  });

  it("ignores goal rows whose slice was truncated away", () => {
    const rendered = lines();
    const target = rowIndex(rendered, "11111111");
    expect(target).toBeGreaterThanOrEqual(0);
    const truncated = [...rendered];
    truncated[target] = "  • …";
    expect(resolveSidebarGoalClick(truncated, goals, 3, target)).toBeUndefined();
  });

  it("treats the divider column as chrome", () => {
    const rendered = lines();
    const target = rowIndex(rendered, "11111111");
    expect(resolveSidebarGoalClick(rendered, goals, 3, target)).toBe(goals[0]!.goalId);
    expect(resolveSidebarGoalClick(rendered, goals, stripAnsi(rendered[target]!).length - 1, target)).toBeUndefined();
  });
});
