import { describe, expect, it } from "vitest";
import { renderActivityTimeline, toActivityTimelineEvent, type ActivityTimelineEvent } from "./activity-timeline.js";

// ANSI escapes are expected in the rendered terminal output; assertions inspect visible text.
// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

describe("renderActivityTimeline", () => {
  it("renders durable event cursors and types", () => {
    expect(stripAnsi(renderActivityTimeline([{ cursor: "7", eventType: "worker.spawned" }], 80)[0]!)).toBe("  ● #7  worker.spawned");
  });


  it("renders an authority gate with classification and automatic outcome", () => {
    const event: ActivityTimelineEvent = {
      cursor: "8",
      eventType: "effect.completed",
      effect: { actor: "worker-3", action: "project.file.edit", target: "src/server.ts", classification: "ordinary", outcome: "auto", kind: "success" },
    };
    const line = stripAnsi(renderActivityTimeline([event], 100)[0]!);
    expect(line).toContain("worker-3");
    expect(line).toContain("ordinary · auto");
    expect(line).toContain("src/server.ts");
  });

  it("renders blocked and awaiting effects with explicit reasons and tiers", () => {
    const events: ActivityTimelineEvent[] = [
      { cursor: "9", eventType: "effect.denied", effect: { actor: "worker-3", action: "system.policy.bypass", target: "policy", classification: "forbidden", outcome: "denied", reason: "forbidden", kind: "error" } },
      { cursor: "10", eventType: "effect.awaiting_approval", effect: { actor: "worker-3", action: "git.remote.push", target: "origin main", classification: "critical", outcome: "awaiting Encore Council", kind: "warning" } },
    ];
    const lines = renderActivityTimeline(events, 100).map(stripAnsi);
    expect(lines[0]).toContain("forbidden · denied");
    expect(lines[0]).toContain("reason: forbidden");
    expect(lines[1]).toContain("critical · awaiting Encore Council");
  });

  it("maps durable wire effect payloads into semantic gate events", () => {
    const mapped = toActivityTimelineEvent({
      cursor: "11", eventId: "event-11", projectId: "project-1", goalId: "goal-1", aggregateVersion: "1", schemaVersion: 1, occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.denied",
      payload: { actor: "worker-3", action: "system.policy.bypass", target: "policy", classification: "forbidden", outcome: "denied", reason: "forbidden" },
    });
    expect(mapped.effect).toMatchObject({ actor: "worker-3", action: "system.policy.bypass", classification: "forbidden", outcome: "denied", reason: "forbidden", kind: "error" });
    const line = stripAnsi(renderActivityTimeline([mapped], 120)[0]!);
    expect(line).toContain("forbidden · denied");
  });

  it("renders an explicit empty state", () => {
    expect(stripAnsi(renderActivityTimeline([], 80)[0]!)).toBe("  No activity yet.");
  });
});
