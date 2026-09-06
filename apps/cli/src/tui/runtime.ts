export interface TuiTerminal {
  start(): void;
  stop(): void;
}

export interface TuiRuntime {
  start(): void;
  stop(): void;
}

export function createTuiRuntime(terminal: TuiTerminal): TuiRuntime {
  let running = false;
  return {
    start() {
      if (running) return;
      running = true;
      terminal.start();
    },
    stop() {
      if (!running) return;
      running = false;
      terminal.stop();
    },
  };
}
