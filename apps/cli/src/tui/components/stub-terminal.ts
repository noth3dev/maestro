import type { Terminal } from "@earendil-works/pi-tui";

const ESC = String.fromCharCode(27);

/** In-memory terminal for click tests: captures the input handler instead of stdin. */
export class StubTerminal implements Terminal {
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

/** Feed one primary-button press/release pair at 1-based screen cells. */
export function sendClick(terminal: StubTerminal, column: number, row: number): void {
  terminal.send(`${ESC}[<0;${column};${row}M`);
  terminal.send(`${ESC}[<0;${column};${row}m`);
}
