import { describe, expect, it } from "vitest";
import { pendingDecisionsFromActivity, renderActivityTimeline, toActivityTimelineEvent, type ActivityTimelineEvent } from "./activity-timeline.js";

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

  it("derives actionable pending decisions from durable activity", () => {
    const pending = toActivityTimelineEvent({
      cursor: "10", eventId: "event-10", projectId: "project-1", goalId: "goal-1", aggregateVersion: "10", schemaVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.awaiting_approval",
      payload: { effect: { effectId: "effect-10", tier: "user", actor: "worker-3", action: "git.remote.push", target: "origin main", classification: "critical", outcome: "awaiting user", kind: "warning" } },
    });
    expect(pendingDecisionsFromActivity([pending])).toEqual([{ tier: "You", action: "git.remote.push origin main", actor: "worker-3" }]);
    const completed = toActivityTimelineEvent({ ...pending, cursor: "11", eventId: "event-11", eventType: "effect.completed", payload: { effect: { ...pending.effect!, outcome: "approved", kind: "success" } } });
    expect(pendingDecisionsFromActivity([pending, completed])).toEqual([]);
  });

  it("keeps concurrent identical effects distinct by durable identity", () => {
    const baseEvent = {
      projectId: "project-1", goalId: "goal-1", aggregateVersion: "1", schemaVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.awaiting_approval",
    };
    const pendingOne = toActivityTimelineEvent({ ...baseEvent, cursor: "1", eventId: "event-1", payload: { effect: { effectId: "effect-1", tier: "Department Head", actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "awaiting user", kind: "warning" } } });
    const pendingTwo = toActivityTimelineEvent({ ...baseEvent, cursor: "2", eventId: "event-2", payload: { effect: { effectId: "effect-2", tier: "user", actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "awaiting user", kind: "warning" } } });
    const completedOne = toActivityTimelineEvent({ ...baseEvent, cursor: "3", eventId: "event-3", eventType: "effect.completed", payload: { effect: { effectId: "effect-1", tier: "Department Head", actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "approved", kind: "success" } } });

    expect(pendingDecisionsFromActivity([pendingOne, pendingTwo, completedOne])).toHaveLength(1);
    expect(pendingDecisionsFromActivity([pendingOne, pendingTwo, completedOne])[0]?.actor).toBe("worker");
  });

  it("uses a semantic glyph for completed, denied, and awaiting effects", () => {
    const lines = renderActivityTimeline([
      { cursor: "13", eventType: "effect.completed", effect: { actor: "worker", action: "project.file.edit", target: "file", classification: "ordinary", outcome: "auto", kind: "success" } },
      { cursor: "14", eventType: "effect.denied", effect: { actor: "worker", action: "system.policy.bypass", target: "policy", classification: "forbidden", outcome: "denied", kind: "error" } },
      { cursor: "15", eventType: "effect.awaiting_approval", effect: { actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "awaiting Encore Council", kind: "warning" } },
    ], 100).map(stripAnsi);
    expect(lines[0]).toContain("✓");
    expect(lines[1]).toContain("✗");
    expect(lines[2]).toContain("⏸");
  });

  it("maps durable wire effect payloads into semantic gate events", () => {
    const mapped = toActivityTimelineEvent({
      cursor: "11", eventId: "event-11", projectId: "project-1", goalId: "goal-1", aggregateVersion: "1", schemaVersion: 1, occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.denied",
      payload: { effectId: "effect-11", tier: "user", actor: "worker-3", action: "system.policy.bypass", target: "policy", classification: "forbidden", outcome: "denied", reason: "forbidden", kind: "error" },
    });
    expect(mapped.effect).toMatchObject({ actor: "worker-3", action: "system.policy.bypass", classification: "forbidden", outcome: "denied", reason: "forbidden", kind: "error" });
    const line = stripAnsi(renderActivityTimeline([mapped], 120)[0]!);
    expect(line).toContain("forbidden · denied");
  });

  it("preserves the source semantic kind when outcome text changes", () => {
    const mapped = toActivityTimelineEvent({
      cursor: "12", eventId: "event-12", projectId: "project-1", goalId: "goal-1", aggregateVersion: "2", schemaVersion: 1, occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.completed",
      payload: { effectId: "effect-12", tier: "automatic progress", actor: "worker-3", action: "project.file.edit", target: "src/server.ts", classification: "ordinary", outcome: "changed", kind: "error" },
    });
    expect(mapped.effect?.kind).toBe("error");
  });

  it("renders an explicit empty state", () => {
    expect(stripAnsi(renderActivityTimeline([], 80)[0]!)).toBe("  No activity yet.");
  });

  it("does not surface a pending decision without durable identity and tier", () => {
    const malformed = toActivityTimelineEvent({
      cursor: "16", eventId: "event-16", projectId: "project-1", goalId: "goal-1", aggregateVersion: "1", schemaVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.awaiting_approval",
      payload: { effect: { actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "awaiting user", kind: "warning" } },
    });

    expect(pendingDecisionsFromActivity([malformed])).toEqual([]);
  });

  it("uses command and numeric effect index as identity and preserves explicit tier", () => {
    const baseEvent = {
      projectId: "project-1", goalId: "goal-1", aggregateVersion: "1", schemaVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z", eventType: "effect.awaiting_approval",
    };
    const pendingOne = toActivityTimelineEvent({ ...baseEvent, cursor: "16", eventId: "event-16", payload: { effect: { commandId: "command-1", index: 0, tier: "Department Head", actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "awaiting approval", kind: "warning" } } });
    const pendingTwo = toActivityTimelineEvent({ ...baseEvent, cursor: "17", eventId: "event-17", payload: { effect: { commandId: "command-1", index: 1, tier: "user", actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "awaiting approval", kind: "warning" } } });
    const completedOne = toActivityTimelineEvent({ ...baseEvent, cursor: "18", eventId: "event-18", eventType: "effect.completed", payload: { effect: { commandId: "command-1", index: 0, tier: "Department Head", actor: "worker", action: "git.remote.push", target: "main", classification: "critical", outcome: "approved", kind: "success" } } });

    expect(pendingDecisionsFromActivity([pendingOne, pendingTwo, completedOne])).toEqual([{ tier: "You", action: "git.remote.push main", actor: "worker" }]);
  });
});
