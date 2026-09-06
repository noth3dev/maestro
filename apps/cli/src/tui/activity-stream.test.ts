import { describe, expect, it } from "vitest";
import { mergeEvents } from "./activity-stream.js";

describe("mergeEvents", () => {
  it("deduplicates reconnect overlap by durable cursor", () => {
    const existing = [{ cursor: "1", eventType: "goal.created" }, { cursor: "2", eventType: "goal.running" }];
    const incoming = [{ cursor: "2", eventType: "goal.running" }, { cursor: "3", eventType: "worker.spawned" }];
    expect(mergeEvents(existing, incoming)).toEqual([...existing, incoming[1]]);
  });
});
