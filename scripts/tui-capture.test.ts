import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TUI_CAPTURE_SIZES,
  assertReproducible,
  captureScenario,
  resolveScenario,
} from "./tui-capture.mjs";

type Run = (args: readonly string[]) => Promise<{ stdout?: string }>;

function fakeTmux(): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: vi.fn(async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "capture-pane") {
        const ansi = args.includes("-e");
        return { stdout: ansi ? "\u001b[31mframe\u001b[0m\n" : "frame\n" };
      }
      return { stdout: "" };
    }),
  };
}

describe("tui capture pipeline", () => {
  it("defines the required six terminal matrix cases", () => {
    expect(DEFAULT_TUI_CAPTURE_SIZES).toEqual([
      { columns: 80, rows: 24 },
      { columns: 120, rows: 40 },
      { columns: 200, rows: 50 },
    ]);
  });

  it("resolves named scenarios into key and capture steps", () => {
    expect(resolveScenario("help")).toEqual([
      { type: "wait", milliseconds: 1_000 },
      { type: "command", command: "/help" },
      { type: "wait", milliseconds: 250 },
      { type: "capture", name: "help" },
    ]);
  });

  it("drives tmux with literal input and captures ANSI and plain frames", async () => {
    const tmux = fakeTmux();
    const result = await captureScenario({
      columns: 80,
      rows: 24,
      noColor: true,
      scenario: [{ type: "command", command: "/help" }, { type: "capture", name: "after-help" }],
      runTmux: tmux.run,
      wait: async () => undefined,
      command: ["node", "dist/main.js"],
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toMatchObject({ name: "after-help", plain: "frame\n" });
    expect(result.frames[0]?.ansi).toContain("\u001b[31m");
    expect(tmux.calls).toContainEqual(["send-keys", "-t", expect.any(String), "-l", "--", "/help"]);
    expect(tmux.calls).toContainEqual(["send-keys", "-t", expect.any(String), "Enter"]);
    expect(tmux.calls.some((call) => call[0] === "new-session" && call.includes("80") && call.includes("24"))).toBe(true);
    expect(tmux.calls.at(-1)?.[0]).toBe("kill-session");
  });

  it("fails reproducibility when the same scenario produces different frames", async () => {
    let runCount = 0;
    const runTmux: Run = async (args) => {
      if (args[0] === "capture-pane") {
        runCount += 1;
        return { stdout: runCount % 2 === 0 ? "second\n" : "first\n" };
      }
      return { stdout: "" };
    };

    await expect(
      assertReproducible({
        columns: 80,
        rows: 24,
        scenario: [{ type: "capture", name: "frame" }],
        runTmux,
        wait: async () => undefined,
        command: ["node", "dist/main.js"],
      }),
    ).rejects.toThrow(/not reproducible/i);
  });
});
