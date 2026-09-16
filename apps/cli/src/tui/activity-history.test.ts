import { describe, expect, it, vi } from "vitest";
import type { GoalEventPage } from "@maestro/api-client";
import { loadActivityHistory } from "./activity-history.js";

const event = (cursor: string) => ({
  cursor,
  eventId: `11111111-1111-4111-8111-11111111111${cursor}`,
  projectId: "22222222-2222-4222-8222-222222222222",
  goalId: "33333333-3333-4333-8333-333333333333",
  aggregateVersion: cursor,
  eventType: "goal_created",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2020-01-01T00:00:00.000Z",
});

describe("activity history loading boundary", () => {
  it("loads pages until the API returns a short page", async () => {
    const firstPage = Array.from({ length: 100 }, () => event("1"));
    const pages: GoalEventPage[] = [
      { events: firstPage, nextCursor: "1" },
      { events: [event("2")], nextCursor: "2" },
    ];
    const listEvents = vi.fn(async (): Promise<GoalEventPage> => pages.shift()!);

    await expect(
      loadActivityHistory({
        client: { listEvents },
        projectId: "22222222-2222-4222-8222-222222222222",
        isCurrent: () => true,
      }),
    ).resolves.toEqual([...firstPage, event("2")]);
    expect(listEvents).toHaveBeenNthCalledWith(1, { projectId: "22222222-2222-4222-8222-222222222222", after: "0" });
    expect(listEvents).toHaveBeenNthCalledWith(2, { projectId: "22222222-2222-4222-8222-222222222222", after: "1" });
  });

  it("stops pagination when the owning view becomes stale", async () => {
    const listEvents = vi.fn(async (): Promise<GoalEventPage> => ({ events: [event("1")], nextCursor: "1" }));

    await expect(
      loadActivityHistory({
        client: { listEvents },
        projectId: "22222222-2222-4222-8222-222222222222",
        isCurrent: () => false,
      }),
    ).resolves.toBeUndefined();
    expect(listEvents).toHaveBeenCalledOnce();
  });
});
