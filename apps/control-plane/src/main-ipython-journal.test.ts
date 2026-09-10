import { describe, expect, it } from "vitest";
import { ipPythonStageJournalEvent } from "./main.js";

describe("IPython stage journal mapping", () => {
  it.each([
    ["completed", "effect_result"],
    ["stopped", "interruption"],
    ["rejected", "failure"],
    ["stale", "failure"],
    ["diverged", "failure"],
    ["failed", "failure"],
  ] as const)("maps %s to %s", (outcome, event) => {
    expect(ipPythonStageJournalEvent(outcome)).toBe(event);
  });
});
