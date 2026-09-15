import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "./registry.js";
import { TUI_READ_COMMAND_KEYS } from "./read-commands.js";
import { TUI_WRITE_COMMAND_KEYS } from "./write-commands.js";

describe("TUI command registry", () => {
  it("contains the complete supported command families", () => {
    const registry = createCommandRegistry();
    for (const command of [
      "billing",
      "luthiery",
      "goal",
      "projects",
      "projection",
      "task-contract",
      "head",
      "council",
      "department-plan",
      "mission-bundle",
      "worker",
      "git",
      "metronome",
      "encore",
      "certification",
      "evidence",
      "budget",
      "events",
      "approval",
      "session",
      "models",
      "conversation",
      "channel",
      "clear",
      "exit",
      "quit",
      "version",
      "copy",
    ]) {
      expect(registry.find(command)).toBeDefined();
    }
  });

  it("registers basic shell commands as actionless local commands", () => {
    const registry = createCommandRegistry();
    for (const name of ["clear", "exit", "quit", "version", "copy"]) {
      expect(registry.find(name)).toMatchObject({ name, actionless: true });
    }
  });

  it("marks mutating and critical commands for confirmation policy", () => {
    const registry = createCommandRegistry();
    expect(registry.find("goal")?.actions.find((action) => action.name === "get")?.kind).toBe("read");
    expect(registry.find("projection")?.actions.find((action) => action.name === "read")?.kind).toBe("read");
    expect(registry.find("goal")?.actions.find((action) => action.name === "pause")?.kind).toBe("write");
    expect(registry.find("goal")?.actions.find((action) => action.name === "select")?.kind).toBe("write");
    expect(registry.find("approval")?.actions.find((action) => action.name === "approve-and-run")?.kind).toBe("critical");
    expect(registry.find("goal")?.actions.find((action) => action.name === "emergency-stop")?.kind).toBe("critical");
    expect(registry.find("worker")?.actions.find((action) => action.name === "list")?.kind).toBe("read");
    expect(registry.find("worker")?.actions.find((action) => action.name === "message")?.kind).toBe("write");
    expect(registry.find("git")?.actions.find((action) => action.name === "worker-advance")?.kind).toBe("write");
    expect(registry.find("critical-action")?.actions.find((action) => action.name === "request")?.kind).toBe("write");
    expect(registry.find("critical-action")?.actions.find((action) => action.name === "approve-and-run")?.kind).toBe("critical");
    expect(registry.find("workers")?.actions.find((action) => action.name === "list")?.kind).toBe("read");
    expect(registry.find("metronome")?.actions.find((action) => action.name === "scan")?.kind).toBe("write");
    expect(registry.find("mode")?.actions.find((action) => action.name === "flashmob")?.kind).toBe("write");
    expect(registry.find("mode")?.actions.find((action) => action.name === "maestro")?.kind).toBe("write");
    expect(registry.find("flashmob")?.actions.find((action) => action.name === "toggle")?.kind).toBe("write");
    expect(registry.find("models")?.actions.find((action) => action.name === "use")?.kind).toBe("write");
    expect(registry.find("concertmaster-report")?.actions.find((action) => action.name === "get")?.kind).toBe("read");
    expect(registry.find("concertmaster-report")?.actions.find((action) => action.name === "generate")?.kind).toBe("write");
    expect(registry.find("capability")?.actions.find((action) => action.name === "select-full-access-mode")?.kind).toBe("critical");
    expect(registry.find("evidence")?.actions.find((action) => action.name === "capture")?.kind).toBe("write");
    expect(registry.find("channel")?.actions.map((action) => `${action.name}:${action.kind}`)).toEqual(["list:read", "read:read", "post:write"]);
    expect(registry.find("billing")?.actions.find((action) => action.name === "get")?.kind).toBe("read");
    expect(registry.find("luthiery")?.actions.find((action) => action.name === "list")?.kind).toBe("read");
  });

  it("autocomplete filters command names", () => {
    expect(
      createCommandRegistry()
        .autocomplete("met")
        .map((command) => command.name),
    ).toEqual(["metronome-challenges", "metronome"]);
  });
});


  it("does not advertise Group B entries with no backing below the TUI", () => {
    const registry = createCommandRegistry();
    const deadEntries = [
      ["head", "sleep"], ["head", "resume"], ["worker", "request-help"],
      ["git", "commit"], ["git", "integrate"], ["git", "cleanup"],
      ["environment", "list"], ["environment", "get"], ["environment", "create"], ["environment", "cleanup"],
      ["device", "list"], ["device", "enroll"], ["device", "grant"], ["device", "revoke"], ["device", "dispatch"],
      ["discord", "list"], ["discord", "triage"], ["discord", "remediate"], ["discord", "close"],
      ["budget", "forecast"], ["approval", "list"], ["portfolio", "list"], ["portfolio", "prioritize"], ["portfolio", "pause"],
      ["evidence", "report"], ["improvement-digests", "inspect"],
    ] as const;
    for (const [name, action] of deadEntries) {
      expect(registry.find(name)?.actions.some((candidate) => candidate.name === action) ?? false, `${name} ${action}`).toBe(false);
    }
  });


  it("maps every registered action to a reachable read, write, or local interactive handler", () => {
    const localInteractiveKeys = new Set([
      "help:list", "login:openai-codex", "login:openai", "login:anthropic",
      "logout:openai-codex", "logout:openai", "logout:anthropic",
      "models:list", "models:use", "model:list", "model:use",
      "mode:list", "mode:flashmob", "mode:maestro", "mode:standard", "flashmob:toggle",
      "goal:select", "session:list", "session:attach", "session:new", "session:retry",
    ]);
    const registry = createCommandRegistry();
    for (const command of registry.all()) for (const action of command.actions) {
      const key = `${command.name}:${action.name}`;
      expect(TUI_READ_COMMAND_KEYS.has(key) || TUI_WRITE_COMMAND_KEYS.has(key) || localInteractiveKeys.has(key), key).toBe(true);
    }
  });
