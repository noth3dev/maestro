import { describe, expect, it } from "vitest";
import {
  ChannelSelectorSchema,
  ChannelMessageSchema,
  channelRoleIds,
  isChannelSelector,
} from "./channel.js";

describe("channel domain", () => {
  it("accepts the three channel scopes and rejects unknown taxonomy", () => {
    expect(ChannelSelectorSchema.parse({ kind: "department", channelId: "engineering" })).toEqual({ kind: "department", channelId: "engineering" });
    expect(ChannelSelectorSchema.parse({ kind: "organization", channelId: "general" })).toEqual({ kind: "organization", channelId: "general" });
    expect(ChannelSelectorSchema.parse({ kind: "encore", channelId: "metronome" })).toEqual({ kind: "encore", channelId: "metronome" });
    expect(() => ChannelSelectorSchema.parse({ kind: "department", channelId: "not-a-department" })).toThrow();
    expect(isChannelSelector({ kind: "encore", channelId: "encore-council" })).toBe(true);
    expect(isChannelSelector({ kind: "encore", channelId: "general" })).toBe(false);
  });

  it("derives the canonical project roles that may post in a channel", () => {
    expect(channelRoleIds({ kind: "department", channelId: "engineering" })).toEqual(["concertmaster", "head-engineering"]);
    expect(channelRoleIds({ kind: "organization", channelId: "general" })).toEqual(["concertmaster"]);
    expect(channelRoleIds({ kind: "organization", channelId: "head-council" })).toContain("head-engineering");
    expect(channelRoleIds({ kind: "encore", channelId: "metronome" })).toEqual(["concertmaster", "encore-metronome"]);
  });

  it("requires bounded non-empty message content and a real attributed identity", () => {
    expect(ChannelMessageSchema.parse({ messageId: "00000000-0000-4000-8000-000000000001", channelId: "00000000-0000-4000-8000-000000000002", sequence: "1", author: { kind: "operator", id: "00000000-0000-4000-8000-000000000003" }, content: "hello", createdAt: "2026-01-01T00:00:00.000Z" }).content).toBe("hello");
    expect(ChannelMessageSchema.parse({ messageId: "00000000-0000-4000-8000-000000000001", channelId: "00000000-0000-4000-8000-000000000002", sequence: "2", author: { kind: "role", id: "encore-metronome" }, content: "signal", createdAt: "2026-01-01T00:00:00.000Z" }).author.kind).toBe("role");
    expect(() => ChannelMessageSchema.parse({ messageId: "00000000-0000-4000-8000-000000000001", channelId: "00000000-0000-4000-8000-000000000002", sequence: "1", author: { kind: "operator", id: "" }, content: "hello", createdAt: "2026-01-01T00:00:00.000Z" })).toThrow();
  });
});
