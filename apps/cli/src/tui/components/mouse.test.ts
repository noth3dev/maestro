import { afterEach, describe, expect, it, vi } from "vitest";
import { Text, TuiAltScreen, VStack, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createClickRegion, withClickRegion } from "./mouse.js";
import { sendClick, StubTerminal } from "./stub-terminal.js";

describe("TUI mouse click wiring", () => {
  const screens: TuiAltScreen[] = [];
  afterEach(() => {
    for (const screen of screens) screen.stop();
    screens.length = 0;
  });

  it("delivers a press/release click pair to a Maestro click region without leaking SGR bytes to keyboard input", () => {
    const terminal = new StubTerminal();
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    const clicks: TuiMouseEvent[] = [];
    tui.setLayoutRoot(
      new VStack([{ component: withClickRegion(new Text("clickable"), (event) => clicks.push(event)), basis: "auto" }]),
    );
    tui.start();
    tui.renderNow(true);
    const seenByKeyboard: string[] = [];
    tui.addInputListener((data) => {
      seenByKeyboard.push(data);
      return undefined;
    });

    terminal.send("a");
    expect(seenByKeyboard).toEqual(["a"]);

    sendClick(terminal, 5, 1);

    expect(clicks.length).toBe(1);
    expect(clicks[0]?.type).toBe("click");
    expect(clicks[0]?.button).toBe("left");
    expect(clicks[0]?.screenX).toBe(4);
    expect(clicks[0]?.screenY).toBe(0);
    expect(seenByKeyboard).toEqual(["a"]);
  });
});

describe("generic click region", () => {
  const screens: TuiAltScreen[] = [];
  afterEach(() => {
    for (const screen of screens) screen.stop();
    screens.length = 0;
  });

  it("routes a click through resolve to onAction against the last rendered width", () => {
    const terminal = new StubTerminal();
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    const resolve = vi.fn((lines: readonly string[], x: number, y: number) => (y === 0 && x < 4 ? "hit" : undefined));
    const onAction = vi.fn();
    const region = createClickRegion({ lines: (width) => [`w${width}`], resolve, onAction });
    tui.setLayoutRoot(new VStack([{ component: region, basis: "auto" }]));
    tui.start();
    tui.renderNow(true);

    sendClick(terminal, 2, 1);

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(["w80"], 1, 0);
    expect(onAction).toHaveBeenCalledWith("hit");
  });

  it("ignores clicks before the first render and on unmapped cells", () => {
    const terminal = new StubTerminal();
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    const onAction = vi.fn();
    const region = createClickRegion({ lines: () => ["clickable"], resolve: () => "hit", onAction });
    tui.setLayoutRoot(new VStack([{ component: region, basis: "auto" }]));
    tui.start();

    sendClick(terminal, 2, 1);
    expect(onAction).not.toHaveBeenCalled();

    tui.renderNow(true);
    const resolveNone = vi.fn(() => undefined);
    const idle = createClickRegion({ lines: () => ["clickable"], resolve: resolveNone, onAction });
    tui.setLayoutRoot(new VStack([{ component: idle, basis: "auto" }]));
    tui.renderNow(true);
    sendClick(terminal, 2, 1);
    expect(resolveNone).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});
