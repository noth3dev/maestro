import { describe, expect, it } from "vitest";
import { renderChannelList, renderChannelPanel } from "./channel-panel.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const channel = { channelId: "44444444-4444-4444-8444-444444444444", projectId, goalId, state: "active" as const, kind: "department" as const, scopeId: "engineering", displayName: "#engineering" };

describe("channel panel", () => {
  it("renders roster-filtered channel summaries and empty state", () => {
    expect(renderChannelList([], 80)).toEqual([
      "Channels",
      "No Goal-scoped channels are available for this Goal.",
      "Sidebar organization and Encore channels are separate from this Goal-filtered result.",
    ]);
    expect(renderChannelList([{ channel, messages: [], members: [{ identityId: "head:engineering", identityKind: "head", displayName: "Engineering Head", departmentId: "engineering", status: "active" }] }], 80)).toEqual(["Channels", "• #engineering · department:engineering · 0 messages · 1 members"]);
  });

  it("renders persisted messages by sequence and bounds long lines", () => {
    const read = { channel, members: [], messages: [
      { messageId: "55555555-5555-4555-8555-555555555555", channelId: channel.channelId, sequence: "2", author: { kind: "operator" as const, id: "operator-1" }, content: "second", createdAt: "2025-01-01T00:00:02.000Z" },
      { messageId: "66666666-6666-4666-8666-666666666666", channelId: channel.channelId, sequence: "1", author: { kind: "head" as const, id: "head:engineering" }, content: "first", createdAt: "2025-01-01T00:00:01.000Z" },
    ] };
    expect(renderChannelPanel(read, 80)).toEqual(["#engineering", "• 1 · head:head:engineering · first", "• 2 · operator:operator-1 · second"]);
    expect(renderChannelPanel({ ...read, messages: [] }, 80)).toEqual(["#engineering", "No messages in this channel."]);
  });
});
