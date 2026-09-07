import { describe, expect, it } from "vitest";
import { renderActivityTimeline } from "./activity-timeline.js";

describe("renderActivityTimeline", () => {
  it("renders durable event cursors and types", () => {
    expect(renderActivityTimeline([{ cursor: "7", eventType: "worker.spawned" }], 80)).toEqual(["✓ [7] worker.spawned"]);
  });

  it("renders an explicit empty state", () => {
    expect(renderActivityTimeline([], 80)).toEqual(["No activity yet."]);
  });
});
