import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "./registry.js";

describe("TUI command registry", () => {
  it("contains the complete supported command families", () => {
    const registry = createCommandRegistry();
    for (const command of [
      "goal",
      "projects",
      "task-contract",
      "head",
      "council",
      "department-plan",
      "mission-bundle",
      "worker",
      "git",
      "environment",
      "device",
      "discord",
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
    ]) {
      expect(registry.find(command)).toBeDefined();
    }
  });

  it("marks mutating and critical commands for confirmation policy", () => {
    const registry = createCommandRegistry();
    expect(registry.find("goal")?.actions.find((action) => action.name === "get")?.kind).toBe("read");
    expect(registry.find("goal")?.actions.find((action) => action.name === "pause")?.kind).toBe("write");
    expect(registry.find("goal")?.actions.find((action) => action.name === "select")?.kind).toBe("write");
    expect(registry.find("approval")?.actions.find((action) => action.name === "approve-and-run")?.kind).toBe("critical");
    expect(registry.find("goal")?.actions.find((action) => action.name === "emergency-stop")?.kind).toBe("critical");
    expect(registry.find("worker")?.actions.find((action) => action.name === "list")?.kind).toBe("read");
    expect(registry.find("critical-action")?.actions.find((action) => action.name === "request")?.kind).toBe("write");
    expect(registry.find("critical-action")?.actions.find((action) => action.name === "approve-and-run")?.kind).toBe("critical");
    expect(registry.find("workers")?.actions.find((action) => action.name === "list")?.kind).toBe("read");
    expect(registry.find("metronome")?.actions.find((action) => action.name === "scan")?.kind).toBe("write");
    expect(registry.find("mode")?.actions.find((action) => action.name === "flashmob")?.kind).toBe("write");
    expect(registry.find("mode")?.actions.find((action) => action.name === "maestro")?.kind).toBe("write");
    expect(registry.find("flashmob")?.actions.find((action) => action.name === "toggle")?.kind).toBe("write");
    expect(registry.find("models")?.actions.find((action) => action.name === "use")?.kind).toBe("write");
  });

  it("autocomplete filters command names", () => {
    expect(
      createCommandRegistry()
        .autocomplete("met")
        .map((command) => command.name),
    ).toEqual(["metronome-challenges", "metronome"]);
  });
});
