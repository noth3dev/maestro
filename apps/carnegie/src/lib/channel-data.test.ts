import { describe, expect, it, vi } from "vitest";
import { loadChannel, postChannelMessage as sendChannelMessage } from "./channel-data.js";
import { channelAuthorName } from "./channel-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const selector = { kind: "department" as const, channelId: "engineering" };
const message = { messageId: "33333333-3333-4333-8333-333333333333", channelId: "44444444-4444-4444-8444-444444444444", sequence: "1", author: { kind: "operator" as const, id: "55555555-5555-4555-8555-555555555555" }, content: "hello", createdAt: "2026-01-01T00:00:00.000Z" };
const read = { channel: { channelId: message.channelId, projectId, goalId, state: "active" as const, kind: "department" as const, scopeId: "engineering", displayName: "#engineering" }, messages: [message], members: [] };

describe("channel GUI data helpers", () => {
  it("loads the selected Goal channel with project scope", async () => {
    const getChannel = vi.fn(async () => read);
    await expect(loadChannel({ getChannel }, goalId, selector, projectId)).resolves.toEqual(read);
    expect(getChannel).toHaveBeenCalledWith(goalId, selector, { projectId });
  });
  it("re-reads the posted message through the same API after a reload", async () => {
    let current = { ...read, messages: [] };
    const getChannel = vi.fn(async () => current);
    const postChannelMessage = vi.fn(async (_goal: string, _selector: typeof selector, _input: { projectId: string; content: string }, _commandId: string) => {
      current = { ...current, messages: [message] };
      return message;
    });
    await sendChannelMessage({ postChannelMessage }, goalId, selector, projectId, "hello", message.messageId);
    await expect(loadChannel({ getChannel }, goalId, selector, projectId)).resolves.toMatchObject({ messages: [message] });
    expect(getChannel).toHaveBeenCalledWith(goalId, selector, { projectId });
  });

  it("posts and returns the durable message using the caller's idempotency key", async () => {
    const postChannelMessage = vi.fn(async () => message);
    await expect(sendChannelMessage({ postChannelMessage }, goalId, selector, projectId, "hello", message.messageId)).resolves.toEqual(message);
    expect(postChannelMessage).toHaveBeenCalledWith(goalId, selector, { projectId, content: "hello" }, message.messageId);
  });
});

describe("channel author names", () => {
  it("names Heads by department and the Overture lead as chair", () => {
    expect(channelAuthorName({ kind: "head", id: "head:safety-compliance" })).toBe("Safety Compliance Head");
    expect(channelAuthorName({ kind: "role", id: "conversation-lead" })).toBe("Overture lead (chair)");
    expect(channelAuthorName({ kind: "operator", id: "x" })).toBe("You");
  });
});
