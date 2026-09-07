import { describe, expect, it, vi } from "vitest";
import { createTuiRuntime } from "./runtime.js";

describe("TuiRuntime", () => {
  it("starts and stops the terminal without leaving raw mode enabled", () => {
    const terminal = { start: vi.fn(), stop: vi.fn() };
    const runtime = createTuiRuntime(terminal);

    runtime.start();
    runtime.stop();

    expect(terminal.start).toHaveBeenCalledOnce();
    expect(terminal.stop).toHaveBeenCalledOnce();
  });
});
