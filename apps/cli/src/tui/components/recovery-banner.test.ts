import { describe, expect, it } from "vitest";
import { renderBlockedSetupPanel, renderRecoveryBanner } from "./recovery-banner.js";

describe("recovery banner", () => {
  it("renders attached cursor state linearly", () => {
    expect(renderRecoveryBanner({ kind: "attached", projectId: "project-1", lastEventCursor: "42" }, 80)).toEqual(["Session attached", "Project: project-1 · Event cursor: 42", "TUI exit does not cancel server-owned work."]);
  });

  it("keeps recovery warning lines within narrow terminal widths", () => {
    const summaries = [
      { kind: "attached", projectId: "project-1", lastEventCursor: "42" } as const,
      { kind: "stale", projectId: "project-1", goalId: "goal-1", goalState: "active", activeWorkers: 1 } as const,
    ];

    for (const width of [40, 60, 80, 120]) {
      for (const summary of summaries) {
        const lines = renderRecoveryBanner(summary, width);
        expect(lines.every((line) => line.length <= width)).toBe(true);
      }
    }

    expect(renderRecoveryBanner(summaries[0], 80).at(-1)).toBe("TUI exit does not cancel server-owned work.");
  });
  it("caps a new-session recovery card instead of stretching it across the pane", () => {
    const lines = renderBlockedSetupPanel({ kind: "new", message: "No saved Maestro session for this workspace" }, 120);
    expect(lines.every((line) => line.length <= 120)).toBe(true);
    expect(lines.every((line) => line.trimStart().length <= 72)).toBe(true);
  });

  it("renders a bounded, horizontally centered blocked setup panel", () => {
    const summary = { kind: "new", message: "No saved Maestro session for this workspace" } as const;
    const narrow = renderBlockedSetupPanel(summary, 80);
    const wide = renderBlockedSetupPanel(summary, 200);
    expect(narrow.some((line) => line.includes("Setup required"))).toBe(true);
    expect(narrow.every((line) => line.length <= 80)).toBe(true);
    expect(wide.every((line) => line.length <= 200)).toBe(true);
    expect(wide[0]?.match(/^ +/)?.[0].length).toBeGreaterThan(narrow[0]?.match(/^ +/)?.[0].length ?? 0);
    expect(narrow.join("\n")).toContain("MAESTRO_API_URL");
    expect(narrow.join("\n")).toContain("restart");
  });

});
