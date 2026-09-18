import { afterEach, describe, expect, it, vi } from "vitest";
import { HStack, Text, TuiAltScreen, VStack, visibleWidth } from "@earendil-works/pi-tui";
import {
  contentWidth,
  isSidebarVisible,
  renderSidebar,
  SIDEBAR_MIN_COLUMNS,
  SIDEBAR_WIDTH,
  toggleSidebar,
  type SidebarSection,
} from "./sidebar.js";
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

  it("toggles the flag and re-renders", () => {
    const host = { sidebarVisible: false, view: { render: vi.fn() } };
    toggleSidebar(host);
    expect(host.sidebarVisible).toBe(true);
    expect(host.view.render).toHaveBeenCalledOnce();
    toggleSidebar(host);
    expect(host.sidebarVisible).toBe(false);
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
