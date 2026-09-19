import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TUI_CAPTURE_SIZES,
  assertReproducible,
  buildCaptureEnvironment,
  captureMatrix,
  captureScenario,
  resolveScenario,
} from "./tui-capture.mjs";

type Run = (args: readonly string[]) => Promise<{ stdout?: string }>;

function fakeTmux(): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  let hasSessionCalls = 0;
  return {
    calls,
    run: vi.fn(async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "has-session") {
        hasSessionCalls += 1;
        if ((hasSessionCalls - 1) % 3 === 0) throw new Error("session does not exist");
        return { stdout: "" };
      }
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
      scenario: [
        { type: "command", command: "/help" },
        { type: "capture", name: "after-help" },
      ],
      runTmux: tmux.run,
      wait: async () => undefined,
      command: ["node", "dist/main.js"],
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toMatchObject({ name: "after-help", plain: "frame\n" });
    expect(result.frames[0]?.ansi).toContain("\u001b[31m");
    expect(tmux.calls).toContainEqual(["send-keys", "-t", expect.any(String), "-l", "/help"]);
    expect(tmux.calls).not.toContainEqual(["send-keys", "-t", expect.any(String), "Escape"]);
    expect(tmux.calls.filter((call) => call[0] === "send-keys" && call.at(-1) === "Enter")).toHaveLength(1);
    expect(tmux.calls.some((call) => call[0] === "new-session" && call.includes("80") && call.includes("24"))).toBe(true);
    expect(tmux.calls.at(-1)?.[0]).toBe("kill-session");
  });

  it("submits a command after observable completion and settles the composer", async () => {
    const calls: string[][] = [];
    const sessions = new Set<string>();
    let paneCaptures = 0;
    const runTmux: Run = async (args) => {
      calls.push([...args]);
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const target = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      const session = target.split(":", 1)[0] ?? target;
      if (args[0] === "new-session") {
        sessions.add(session);
        return { stdout: "" };
      }
      if (args[0] === "has-session" && !sessions.has(session)) throw new Error("session does not exist");
      if (args[0] === "kill-session") {
        sessions.delete(session);
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") {
        const commandStillInComposer = paneCaptures < 2;
        paneCaptures += 1;
        const plain = commandStillInComposer ? "│ › /models list\n" : "│ › \n";
        return { stdout: args.includes("-e") ? plain.replace("/models", "\u001b[31m/models\u001b[0m") : plain };
      }
      return { stdout: "" };
    };

    await captureScenario({
      columns: 120,
      rows: 40,
      scenario: [{ type: "command", command: "/models list" }],
      runTmux,
      wait: async () => undefined,
      startupWaitMilliseconds: 0,
      command: ["node", "dist/main.js"],
    });

    expect(calls.filter((call) => call[0] === "send-keys" && call.at(-1) === "Enter")).toHaveLength(2);
    expect(calls.some((call) => call.at(-1) === "Escape")).toBe(false);
  });

  it("fails closed when a command remains in the composer after the submit retry", async () => {
    const sessions = new Set<string>();
    const runTmux: Run = async (args) => {
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const target = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      const session = target.split(":", 1)[0] ?? target;
      if (args[0] === "new-session") {
        sessions.add(session);
        return { stdout: "" };
      }
      if (args[0] === "has-session" && !sessions.has(session)) throw new Error("session does not exist");
      if (args[0] === "kill-session") {
        sessions.delete(session);
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") return { stdout: "│ › /models list\n" };
      return { stdout: "" };
    };

    await expect(
      captureScenario({
        columns: 120,
        rows: 40,
        scenario: [{ type: "command", command: "/models list" }],
        runTmux,
        wait: async () => undefined,
        startupWaitMilliseconds: 0,
        commandSubmitTimeoutMilliseconds: 100,
        command: ["node", "dist/main.js"],
      }),
    ).rejects.toThrow(/did not submit/);
  });

  it("captures the full six-case size and color matrix", async () => {
    const sessions = new Map<string, boolean>();
    const runTmux: Run = async (args) => {
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const session = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      if (args[0] === "new-session") {
        sessions.set(session, true);
        return { stdout: "" };
      }
      if (args[0] === "has-session") {
        if (sessions.get(session) !== true) {
          sessions.set(session, true);
          throw new Error("session does not exist");
        }
        return { stdout: "" };
      }
      if (args[0] === "kill-session") {
        sessions.set(session, false);
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") return { stdout: args.includes("-e") ? "\u001b[7mframe\u001b[0m\n" : "frame\n" };
      return { stdout: "" };
    };

    const results = await (
      await import("./tui-capture.mjs")
    ).captureMatrix({
      scenario: [{ type: "capture", name: "frame" }],
      runTmux,
      wait: async () => undefined,
      startupWaitMilliseconds: 0,
      command: ["node", "dist/main.js"],
    });

    expect(results).toHaveLength(6);
    expect(results.map(({ columns, rows, noColor }) => `${columns}x${rows}:${noColor ? "no-color" : "color"}`)).toEqual([
      "80x24:color",
      "80x24:no-color",
      "120x40:color",
      "120x40:no-color",
      "200x50:color",
      "200x50:no-color",
    ]);
  });

  it("does not invoke kill-server and cleans up only an owned session after a step fails", async () => {
    const tmux = fakeTmux();
    const failingRun: Run = async (args) => {
      if (args[0] === "send-keys") throw new Error("synthetic send failure");
      return tmux.run(args);
    };

    await expect(
      captureScenario({
        columns: 80,
        rows: 24,
        scenario: [{ type: "command", command: "/help" }],
        runTmux: failingRun,
        wait: async () => undefined,
        startupWaitMilliseconds: 0,
        command: ["node", "dist/main.js"],
      }),
    ).rejects.toThrow("synthetic send failure");
    expect(tmux.calls.some((call) => call[0] === "kill-server")).toBe(false);
    expect(tmux.calls.at(-1)?.[0]).toBe("kill-session");
  });

  it("cleans up a generated session when new-session creates it before the client reports failure", async () => {
    const calls: string[][] = [];
    let created = false;
    const runTmux: Run = async (args) => {
      calls.push([...args]);
      if (args[0] === "has-session") {
        if (!created) throw new Error("session does not exist");
        return { stdout: "" };
      }
      if (args[0] === "new-session") {
        created = true;
        throw new Error("tmux client disconnected after session creation");
      }
      if (args[0] === "kill-session") {
        created = false;
        return { stdout: "" };
      }
      return { stdout: "" };
    };

    await expect(
      captureScenario({
        columns: 80,
        rows: 24,
        scenario: [{ type: "capture", name: "never-reached" }],
        runTmux,
        wait: async () => undefined,
        startupWaitMilliseconds: 0,
        command: ["node", "dist/main.js"],
      }),
    ).rejects.toThrow("tmux client disconnected after session creation");
    expect(calls.at(-1)?.[0]).toBe("kill-session");
  });

  it("waits for the live readiness marker before running scenario steps", async () => {
    const waits: number[] = [];
    const sessions = new Set<string>();
    let paneCaptures = 0;
    let readinessSeen = false;
    const runTmux: Run = async (args) => {
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const target = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      const session = target.split(":", 1)[0] ?? target;
      if (args[0] === "new-session") {
        sessions.add(session);
        return { stdout: "" };
      }
      if (args[0] === "has-session" && !sessions.has(session)) throw new Error("session does not exist");
      if (args[0] === "kill-session") {
        sessions.delete(session);
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") {
        paneCaptures += 1;
        if (paneCaptures >= 5) readinessSeen = true;
        return { stdout: readinessSeen ? "Session attached\n" : "booting\n" };
      }
      if (args[0] === "send-keys") expect(readinessSeen).toBe(true);
      return { stdout: "" };
    };

    await captureScenario({
      columns: 80,
      rows: 24,
      liveEnvironment: true,
      readinessTimeoutMilliseconds: 500,
      scenario: [
        { type: "command", command: "/help" },
        { type: "capture", name: "live" },
      ],
      runTmux,
      wait: async (milliseconds) => waits.push(milliseconds),
      startupWaitMilliseconds: 0,
      command: ["node", "dist/main.js"],
    });

    expect(paneCaptures).toBeGreaterThanOrEqual(6);
    expect(waits).toContain(50);
  });

  it("fails closed and cleans up when live readiness never appears", async () => {
    const sessions = new Set<string>();
    let killSessionCalls = 0;
    const runTmux: Run = async (args) => {
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const target = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      const session = target.split(":", 1)[0] ?? target;
      if (args[0] === "new-session") {
        sessions.add(session);
        return { stdout: "" };
      }
      if (args[0] === "has-session" && !sessions.has(session)) throw new Error("session does not exist");
      if (args[0] === "kill-session") {
        killSessionCalls += 1;
        sessions.delete(session);
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") return { stdout: "booting\n" };
      return { stdout: "" };
    };

    await expect(
      captureScenario({
        columns: 80,
        rows: 24,
        liveEnvironment: true,
        readinessTimeoutMilliseconds: 100,
        scenario: [{ type: "capture", name: "never-reached" }],
        runTmux,
        wait: async () => undefined,
        startupWaitMilliseconds: 0,
        command: ["node", "dist/main.js"],
      }),
    ).rejects.toThrow(/readiness marker did not appear/);
    expect(killSessionCalls).toBe(1);
  });

  it("uses a longer default startup window only for live captures", async () => {
    const captureStartupWait = async (liveEnvironment: boolean) => {
      const waits: number[] = [];
      let hasSessionCalls = 0;
      const runTmux: Run = async (args) => {
        if (args[0] === "has-session") {
          if (hasSessionCalls++ === 0) throw new Error("session does not exist");
          return { stdout: "" };
        }
        if (args[0] === "capture-pane") return { stdout: liveEnvironment ? "Session attached\n" : "frame\n" };
        return { stdout: "" };
      };
      await captureScenario({
        columns: 80,
        rows: 24,
        liveEnvironment,
        scenario: [{ type: "capture", name: "frame" }],
        runTmux,
        wait: async (milliseconds) => waits.push(milliseconds),
        command: ["node", "dist/main.js"],
      });
      return waits[0];
    };

    await expect(captureStartupWait(false)).resolves.toBe(1_500);
    await expect(captureStartupWait(true)).resolves.toBe(3_000);
  });

  it("captures every required size and color mode only after reproducibility checks", async () => {
    let captureCount = 0;
    const sessions = new Map<string, boolean>();
    const runTmux: Run = async (args) => {
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const target = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      const session = target.split(":", 1)[0] ?? target;
      if (args[0] === "new-session") {
        sessions.set(session, true);
        return { stdout: "" };
      }
      if (args[0] === "has-session") {
        if (sessions.get(session) !== true) {
          sessions.set(session, true);
          throw new Error("session does not exist");
        }
        return { stdout: "" };
      }
      if (args[0] === "kill-session") {
        sessions.set(session, false);
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") {
        captureCount += 1;
        return { stdout: args.includes("-e") ? "\u001b[31mstable\u001b[0m\n" : "stable\n" };
      }
      return { stdout: "" };
    };

    const cases = await captureMatrix({
      scenario: [{ type: "capture", name: "frame" }],
      runTmux,
      wait: async () => undefined,
      command: ["node", "dist/main.js"],
    });

    expect(cases).toHaveLength(6);
    expect(cases.map((item) => [item.columns, item.rows, item.noColor])).toEqual([
      [80, 24, false],
      [80, 24, true],
      [120, 40, false],
      [120, 40, true],
      [200, 50, false],
      [200, 50, true],
    ]);
    expect(captureCount).toBe(24);
  });

  it("captures a dynamic matrix once without claiming reproducibility", async () => {
    let captureCount = 0;
    const sessions = new Set<string>();
    const runTmux: Run = async (args) => {
      const targetIndex = args.indexOf("-t");
      const sessionIndex = args.indexOf("-s");
      const target = (targetIndex >= 0 ? args[targetIndex + 1] : sessionIndex >= 0 ? args[sessionIndex + 1] : "") ?? "";
      const session = target.split(":", 1)[0] ?? target;
      if (args[0] === "new-session") {
        sessions.add(session);
        return { stdout: "" };
      }
      if (args[0] === "has-session" && !sessions.has(session)) throw new Error("session does not exist");
      if (args[0] === "kill-session") sessions.delete(session);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        return { stdout: args.includes("-e") ? "\u001b[31mdynamic\u001b[0m\n" : "dynamic\n" };
      }
      return { stdout: "" };
    };

    const cases = await captureMatrix({
      scenario: [{ type: "capture", name: "frame" }],
      sizes: [{ columns: 80, rows: 24 }],
      colorModes: [false, true],
      reproducible: false,
      runTmux,
      wait: async () => undefined,
      startupWaitMilliseconds: 0,
      command: ["node", "dist/main.js"],
    });

    expect(cases).toHaveLength(2);
    expect(cases.every((item) => item.reproducible === false)).toBe(true);
    expect(captureCount).toBe(4);
  });

  it("removes Maestro credentials and local auto-start from the child environment", () => {
    const environment = buildCaptureEnvironment({
      PATH: "/usr/bin",
      HOME: "/real-home",
      MAESTRO_API_URL: "https://example.invalid",
      MAESTRO_API_TOKEN: "secret",
      MAESTRO_MODEL_GATEWAY_TOKEN: "gateway-secret",
      NO_COLOR: "1",
    });

    expect(environment).toMatchObject({ PATH: "/usr/bin", TERM: "screen-256color", MAESTRO_DISABLE_LOCAL_AUTOSTART: "true" });
    expect(environment).not.toHaveProperty("HOME", "/real-home");
    expect(environment).not.toHaveProperty("MAESTRO_API_URL");
    expect(environment).not.toHaveProperty("MAESTRO_API_TOKEN");
    expect(environment).not.toHaveProperty("MAESTRO_MODEL_GATEWAY_TOKEN");
    expect(environment).not.toHaveProperty("NO_COLOR");
  });

  it("fails reproducibility when the same scenario produces different frames", async () => {
    let runCount = 0;
    let hasSessionCalls = 0;
    const runTmux: Run = async (args) => {
      if (args[0] === "has-session") {
        hasSessionCalls += 1;
        if ((hasSessionCalls - 1) % 3 === 0) throw new Error("session does not exist");
        return { stdout: "" };
      }
      if (args[0] === "capture-pane") {
        runCount += 1;
        return { stdout: Math.ceil(runCount / 2) === 1 ? "first\n" : "second\n" };
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
