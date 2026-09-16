import { describe, expect, it } from "vitest";
import { renderRecoveryBanner } from "./recovery-banner.js";

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
});
