import { describe, expect, it } from "vitest";
import type { GoalEvent } from "@maestro/api-client";
import { pendingDecisionsForView } from "./pending-decisions.js";

const awaitingEvent = {
  cursor: "1",
  eventId: "event-1",
  projectId: "project-1",
  goalId: "goal-1",
  eventType: "effect.awaiting_approval",
  occurredAt: "2030-01-01T00:00:00.000Z",
  payload: {
    effect: {
      identity: "effect-1",
      actor: "operator",
      action: "remote_send",
      target: "example.test",
      classification: "critical",
      outcome: "awaiting",
      tier: "user",
      kind: "warning",
    },
  },
} as GoalEvent;

describe("pending decision projection", () => {
  it("filters activity to the active Goal and preserves durable approval identity", () => {
    expect(pendingDecisionsForView({ goalId: "goal-1", activity: [awaitingEvent] })).toEqual([
      { identity: "effect-1", tier: "You", action: "remote_send example.test", actor: "operator" },
    ]);
    expect(pendingDecisionsForView({ goalId: "other-goal", activity: [awaitingEvent] })).toEqual([]);
  });

  it("prepends a valid pending confirmation with normalized display fields", () => {
    expect(
      pendingDecisionsForView({
        goalId: undefined,
        activity: [],
        pendingConfirmation: {
          summary: {
            identity: " effect-2 ",
            actor: " operator ",
            tier: "user",
            action: "project.file.edit",
            target: "README.md",
            effect: "write",
            expiresAt: "2030-01-01T00:00:00.000Z",
          },
        },
      }),
    ).toEqual([{ identity: "effect-2", tier: "You", action: "project.file.edit README.md", actor: "operator" }]);
  });
});
