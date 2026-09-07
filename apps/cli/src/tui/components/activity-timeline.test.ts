import { describe, expect, it } from "vitest";
import { renderActivityTimeline } from "./activity-timeline.js";

// ANSI escapes are expected in the rendered terminal output; assertions inspect visible text.
// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

describe("renderActivityTimeline", () => {
  it("renders durable event cursors and types", () => {
    expect(stripAnsi(renderActivityTimeline([{ cursor: "7", eventType: "worker.spawned" }], 80)[0]!)).toBe("  ● #7  worker.spawned");
  });

  it("renders an explicit empty state", () => {
    expect(stripAnsi(renderActivityTimeline([], 80)[0]!)).toBe("  No activity yet.");
  });
});
