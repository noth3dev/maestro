import { describe, expect, it, vi } from "vitest";
import type { GoalEvent } from "@maestro/api-client";
import { filterEvents, loadEventPage, eventLinks, type EventFilters } from "./event-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalA = "22222222-2222-4222-8222-222222222222";
const goalB = "33333333-3333-4333-8333-333333333333";

function event(eventId: string, cursor: string, goalId = goalA, eventType = "worker.spawned", occurredAt = "2026-01-01T00:00:00.000Z"): GoalEvent {
  return { eventId, cursor, projectId, goalId, aggregateVersion: cursor, eventType, schemaVersion: 1, payload: {}, occurredAt };
}

describe("Carnegie durable event data", () => {
  it("loads a server-backed event page with the exact project and cursor scope", async () => {
    const page = { events: [event("event-1", "7")], nextCursor: "7" };
    const listEvents = vi.fn(async () => page);
    const api = { getChannel: vi.fn(), postChannelMessage: vi.fn(), listEvents };

    await expect(loadEventPage(api, { projectId, after: "5" })).resolves.toEqual(page);
    expect(listEvents).toHaveBeenCalledWith({ projectId, after: "5" });
  });

  it("filters the durable page by Goal, type, cursor range, and time window without inventing events", () => {
    const events = [
      event("event-1", "1", goalA, "worker.spawned", "2026-01-01T00:00:00.000Z"),
      event("event-2", "2", goalB, "certification.created", "2026-01-02T00:00:00.000Z"),
      event("event-3", "3", goalA, "certification.created", "2026-01-03T00:00:00.000Z"),
    ];
    const filters: EventFilters = { goalId: goalA, eventType: "certification.created", afterCursor: "1", beforeCursor: "4", fromTime: "2026-01-02T00:00:00.000Z", toTime: "2026-01-04T00:00:00.000Z" };
    expect(filterEvents(events, filters).map((item) => item.eventId)).toEqual(["event-3"]);
  });

  it("maps only server event evidence to truthful destinations", () => {
    expect(eventLinks(event("event-1", "1", goalA, "worker.execution_started"))).toEqual(expect.arrayContaining([{ label: "Open Worker progress", view: "channel" }]));
    expect(eventLinks(event("event-2", "2", goalA, "certification.created"))).toEqual(expect.arrayContaining([{ label: "Open Evidence Log", view: "evlog" }]));
    expect(eventLinks(event("event-3", "3", goalA, "approval.requested"))).toEqual(expect.arrayContaining([{ label: "Open Inbox", view: "inbox" }]));
    expect(eventLinks(event("event-4", "4", goalA, "git.integration_updated"))).toEqual(expect.arrayContaining([{ label: "Open Git", view: "git" }]));
  });
});
