import { describe, expect, it } from "vitest";
import { EventCursorSchema, GoalEventSchema } from "./index.js";

describe("event contracts", () => {
  it.each(["0", "1", "9007199254740993", "9223372036854775807"])("accepts exact PostgreSQL bigint cursor %s", (cursor) => {
    expect(EventCursorSchema.parse(cursor)).toBe(cursor);
  });
  it.each([0, "01", "-1", "9223372036854775808"])("rejects unsafe cursor %s", (cursor) => {
    expect(() => EventCursorSchema.parse(cursor)).toThrow();
  });
  it("keeps event bigints as strings", () => {
    expect(GoalEventSchema.parse({ cursor: "9007199254740993", eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02", projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01", goalId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", aggregateVersion: "9007199254740993", eventType: "GoalCreated", schemaVersion: 1, payload: {}, occurredAt: "2025-01-01T00:00:00.000Z" }).cursor).toBe("9007199254740993");
  });
});
