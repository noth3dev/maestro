import { afterEach, describe, expect, it } from "vitest";
import { Text, TuiAltScreen, VStack, type Terminal, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { withClickRegion } from "./mouse.js";

const ESC = String.fromCharCode(27);

class StubTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  private inputHandler?: (data: string) => void;

  start(onInput: (data: string) => void): void {
    this.inputHandler = onInput;
  }

  stop(): void {}

  async drainInput(): Promise<void> {}

  write(): void {}

  moveBy(): void {}

  hideCursor(): void {}

  showCursor(): void {}

  clearLine(): void {}

  clearFromCursor(): void {}

  clearScreen(): void {}

  setTitle(): void {}

  setProgress(): void {}

  send(data: string): void {
    this.inputHandler?.(data);
  }
}

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

    terminal.send(`${ESC}[<0;5;1M`);
    terminal.send(`${ESC}[<0;5;1m`);

    expect(clicks.length).toBe(1);
    expect(clicks[0]?.type).toBe("click");
    expect(clicks[0]?.button).toBe("left");
    expect(clicks[0]?.screenX).toBe(4);
    expect(clicks[0]?.screenY).toBe(0);
    expect(seenByKeyboard).toEqual(["a"]);
  });
});
