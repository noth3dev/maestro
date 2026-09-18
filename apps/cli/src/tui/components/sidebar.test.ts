import { afterEach, describe, expect, it, vi } from "vitest";
import { HStack, Text, TuiAltScreen, VStack, visibleWidth } from "@earendil-works/pi-tui";
import {
  contentWidth,
  isSidebarVisible,
  renderFooterSection,
  renderGoalSection,
  renderNavSection,
  renderSidebar,
  SIDEBAR_MIN_COLUMNS,
  SIDEBAR_WIDTH,
  toggleSidebar,
  type SidebarSection,
} from "./sidebar.js";
import { NAV_ROWS, resolveSidebarGoalClick, resolveSidebarNavClick } from "./sidebar-nav.js";
import { renderChannelSection, resolveSidebarChannelClick } from "./sidebar-channels.js";
import { StubTerminal } from "./stub-terminal.js";

function plain(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("sidebar shell", () => {
  it("renders a fixed-width bordered shell with a title", () => {
    const lines = renderSidebar(SIDEBAR_WIDTH);
    expect(SIDEBAR_WIDTH).toBe(26);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    expect(plain(lines[1]!)).toContain("sidebar");
  });

  it("truncates without throwing at narrow widths", () => {
    for (const width of [0, 1, 10, 25]) {
      const lines = renderSidebar(width, []);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(0, width));
    }
  });

  it("renders row groups between chrome with fixed label column", () => {
    const sections: SidebarSection[] = [
      { title: "status", rows: [{ label: "model", value: "gpt-5" }, { label: "goal", value: "auth-refactor · running" }] },
      { rows: [{ label: "conn", value: "connected" }] },
    ];
    const lines = renderSidebar(SIDEBAR_WIDTH, sections);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    const text = lines.map(plain).join("\n");
    expect(text).toContain("status");
    expect(text).toContain("model");
    expect(text).toContain("gpt-5");
    expect(text).toContain("conn");
  });

  it("truncates long values to the remaining cells", () => {
    const sections: SidebarSection[] = [{ rows: [{ label: "model", value: "openai/very-long-model-name-here" }] }];
    const lines = renderSidebar(SIDEBAR_WIDTH, sections);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    expect(plain(lines[2]!)).toContain("openai");
  });
});

describe("sidebar nav badges", () => {
  it("appends the inbox pending count to the label and omits it at zero", () => {
    const section = renderNavSection(NAV_ROWS, "home", { inbox: "(3)" });
    expect(section.title).toBe("views");
    expect(section.rows.find((row) => row.id === "inbox")?.label).toBe("inbox (3)");
    expect(section.rows.find((row) => row.id === "home")?.label).toBe("search");
    const cleared = renderNavSection(NAV_ROWS, "home", {});
    expect(cleared.rows.find((row) => row.id === "inbox")?.label).toBe("inbox");
  });

  it("renders renamed rows plus badges untruncated at full width", () => {
    const lines = renderSidebar(SIDEBAR_WIDTH, [renderNavSection(NAV_ROWS, "billing", { inbox: "(3)", billing: "(62%)" })]);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    const text = plain(lines.join("\n"));
    expect(text).toContain("search");
    expect(text).toContain("evidence log");
    expect(text).toContain("inbox (3)");
    expect(text).toContain("billing (62%)");
  });

  it("keeps badged rows within the fixed width", () => {
    const lines = renderSidebar(SIDEBAR_WIDTH, [renderNavSection(NAV_ROWS, "inbox", { inbox: "(12)" })]);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    expect(plain(lines.join("\n"))).toContain("inbox (12)");
  });
});

describe("sidebar goal section", () => {
  const goals = [
    { goalId: "11111111-2222-4333-8444-555555555555", state: "running" },
    { goalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", state: "paused" },
  ];

  it("lists id slices with state and marks the selected goal", () => {
    const section = renderGoalSection(goals, goals[0]!.goalId, undefined);
    expect(section?.title).toBe("goals");
    expect(section?.rows.map((row) => row.label)).toEqual(["• 11111111 · running", "aaaaaaaa · paused"]);
    expect(section?.rows.map((row) => row.id)).toEqual([goals[0]!.goalId, goals[1]!.goalId]);
    for (const row of section?.rows ?? []) expect(row.selectable).toBe(true);
  });

  it("marks focus without disturbing the selection marker", () => {
    const section = renderGoalSection(goals, goals[0]!.goalId, goals[1]!.goalId);
    expect(section?.rows[0]?.focused).toBe(false);
    expect(section?.rows[1]?.focused).toBe(true);
    expect(section?.rows[0]?.label).toContain("•");
  });

  it("returns undefined when there are no cached goals", () => {
    expect(renderGoalSection([], undefined, undefined)).toBeUndefined();
  });

  it("caps at five rows with a non-selectable trailer", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({ goalId: `0000000${index}-2222-4333-8444-555555555555`, state: "running" }));
    const section = renderGoalSection(many, undefined, undefined);
    expect(section?.rows.length).toBe(6);
    expect(section?.rows.slice(0, 5).every((row) => row.selectable === true)).toBe(true);
    expect(section?.rows[5]).toMatchObject({ label: "+2 more", selectable: false });
  });

  it("keeps goal rows within the fixed width", () => {
    const section = renderGoalSection(goals, goals[0]!.goalId, goals[1]!.goalId);
    const lines = renderSidebar(SIDEBAR_WIDTH, [section!]);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    expect(plain(lines.join("\n"))).toContain("11111111 · running");
  });
});

describe("sidebar footer", () => {
  it("renders non-selectable key hints under a trailing title", () => {
    const section = renderFooterSection();
    expect(section.title).toBe("keys");
    expect(section.rows.length).toBe(2);
    for (const row of section.rows) {
      expect(row.selectable).not.toBe(true);
      expect(row.id).toBeUndefined();
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.value).toBeDefined();
    }
  });

  it("keeps footer rows within the fixed width", () => {
    const lines = renderSidebar(SIDEBAR_WIDTH, [renderFooterSection()]);
    for (const line of lines) expect(visibleWidth(line)).toBe(SIDEBAR_WIDTH);
    const text = lines.map(plain).join("\n");
    expect(text).toContain("keys");
    expect(text).toContain("ctrl+b");
  });

  it("keeps footer text clear of nav-label substrings", () => {
    const lines = renderSidebar(SIDEBAR_WIDTH, [renderFooterSection()]);
    const text = lines.map(plain).join("\n");
    for (const row of NAV_ROWS) expect(text.includes(row.label)).toBe(false);
    lines.forEach((line, y) => {
      expect(resolveSidebarNavClick(lines, 3, y)).toBeUndefined();
    });
  });
});

describe("sidebar section composition", () => {
  const goals = [{ goalId: "11111111-2222-4333-8444-555555555555", state: "running" }];
  const channels = [
    {
      channel: { kind: "department" as const, scopeId: "engineering", displayName: "#engineering" },
      messages: [{}, {}],
      members: [{}],
    },
  ];

  function composed() {
    return renderSidebar(SIDEBAR_WIDTH, [
      renderNavSection(NAV_ROWS, undefined),
      renderChannelSection(channels as never, undefined)!,
      renderGoalSection(goals, undefined, undefined)!,
      renderFooterSection(),
    ]);
  }

  function rowIndex(rendered: readonly string[], fragment: string): number {
    return rendered.findIndex((line) => plain(line).includes(fragment));
  }

  it("keeps goal and channel clicks stable with the footer appended", () => {
    const rendered = composed();
    expect(resolveSidebarGoalClick(rendered, goals, 3, rowIndex(rendered, "11111111"))).toBe(goals[0]!.goalId);
    expect(resolveSidebarChannelClick(rendered, channels as never, 3, rowIndex(rendered, "#engineering"))).toBe(
      "channel:department:engineering",
    );
  });

  it("leaves footer rows unmapped for every resolver", () => {
    const rendered = composed();
    const footerTop = rowIndex(rendered, "keys");
    expect(footerTop).toBeGreaterThanOrEqual(0);
    for (let y = footerTop; y < rendered.length - 1; y++) {
      expect(resolveSidebarNavClick(rendered, 3, y)).toBeUndefined();
      expect(resolveSidebarGoalClick(rendered, goals, 3, y)).toBeUndefined();
      expect(resolveSidebarChannelClick(rendered, channels as never, 3, y)).toBeUndefined();
    }
  });
});

describe("sidebar visibility", () => {
  it("shows only when explicitly enabled on wide terminals", () => {
    expect(isSidebarVisible(true, 120)).toBe(true);
    expect(isSidebarVisible(true, SIDEBAR_MIN_COLUMNS)).toBe(true);
    expect(isSidebarVisible(true, SIDEBAR_MIN_COLUMNS - 1)).toBe(false);
    expect(isSidebarVisible(true, 80)).toBe(false);
    expect(isSidebarVisible(false, 120)).toBe(false);
    expect(SIDEBAR_MIN_COLUMNS).toBe(100);
  });

  it("subtracts the sidebar width only when visible", () => {
    expect(contentWidth(120, true)).toBe(94);
    expect(contentWidth(100, true)).toBe(74);
    expect(contentWidth(99, true)).toBe(99);
    expect(contentWidth(80, true)).toBe(80);
    expect(contentWidth(120, false)).toBe(120);
  });

  it("toggles visibility with focus following, and re-renders", () => {
    const host = { sidebarVisible: false, sidebarFocus: undefined as string | undefined, view: { render: vi.fn() } };
    const rows = [{ id: "a" }, { id: "b" }];
    toggleSidebar(host, rows);
    expect(host.sidebarVisible).toBe(true);
    expect(host.sidebarFocus).toBe("a");
    expect(host.view.render).toHaveBeenCalledOnce();
    toggleSidebar(host, rows);
    expect(host.sidebarVisible).toBe(false);
    expect(host.sidebarFocus).toBeUndefined();
    expect(host.view.render).toHaveBeenCalledTimes(2);
  });
});

describe("sidebar layout mechanics", () => {
  const screens: TuiAltScreen[] = [];
  afterEach(() => {
    for (const screen of screens) screen.stop();
    screens.length = 0;
  });

  it("distributes a fixed 26-column pane beside a growing main pane", () => {
    const terminal = new StubTerminal();
    terminal.columns = 120;
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    let shown = true;
    const sidebar = {
      render: (width: number) => renderSidebar(width),
      invalidate: () => undefined,
    };
    tui.setLayoutRoot(
      new HStack([
        { component: sidebar, basis: SIDEBAR_WIDTH, shrink: 0, minSize: 0, visible: () => shown },
        { component: new VStack([{ component: new Text("main"), basis: "auto" }]), basis: 0, grow: 1, minSize: 0 },
      ]),
    );
    tui.start();
    tui.renderNow(true);
    const frame = new HStack([
      { component: sidebar, basis: SIDEBAR_WIDTH, shrink: 0, minSize: 0, visible: () => shown },
      { component: new VStack([{ component: new Text("main"), basis: "auto" }]), basis: 0, grow: 1, minSize: 0 },
    ]).render(120);
    for (const line of frame) expect(visibleWidth(line)).toBe(120);
    expect(plain(frame[1]!)).toContain("sidebar");
    shown = false;
    const hidden = new HStack([
      { component: sidebar, basis: SIDEBAR_WIDTH, shrink: 0, minSize: 0, visible: () => shown },
      { component: new VStack([{ component: new Text("main"), basis: "auto" }]), basis: 0, grow: 1, minSize: 0 },
    ]).render(120);
    expect(plain(hidden.join("\n"))).not.toContain("sidebar");
  });
});
