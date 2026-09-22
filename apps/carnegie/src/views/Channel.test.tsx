import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Channel } from "./Channel.js";
import { loadChannel, postChannelMessage, createChannelMessageAttempt } from "../lib/channel-data.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));

vi.mock("../connection.js", () => ({
  useConnection: () => ({
    config: { apiUrl: "https://control-plane.test", token: "credential.secret", projectId: "11111111-1111-4111-8111-111111111111" },
    loading: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));
vi.mock("../goals.js", () => ({
  useGoals: () => ({ goals: [], selectedGoalId: "22222222-2222-4222-8222-222222222222", selectGoal: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../useGoalDetail.js", () => ({
  useGoalDetail: () => ({ detail: undefined, loading: false, error: undefined, refresh: vi.fn() }),
}));
vi.mock("../useGoalWorkers.js", () => ({
  useGoalWorkers: () => ({ workers: [{ workerId: "worker-1" }], loading: true, error: "disconnected", loadedFor: undefined }),
}));

describe("Channel view", () => {
  it("renders an enabled real-channel composer and exposes the durable channel taxonomy", () => {
    const html = renderToStaticMarkup(<Channel onNavigate={vi.fn()} />);
    expect(html).toContain('placeholder="Message #engineering"');
    expect(html).not.toContain("Posting a message here isn't wired to anything real yet");
    expect(html).toContain('value="department:engineering"');
    expect(html).toContain('value="organization:general"');
    expect(html).toContain('value="encore:metronome"');
    expect(html).not.toMatch(/class="chan-composer-input"[^>]* disabled/);
  });

  it("keeps the last roster visible while surfacing a failed refresh", () => {
    const html = renderToStaticMarkup(<Channel onNavigate={vi.fn()} />);
    expect(html).toContain("refreshing Worker roster; showing last durable state");
    expect(html).toContain("disconnected");
  });

  it("preserves exact Goal/project/channel scope and the caller command ID", async () => {
    const api = {
      getChannel: vi.fn(async () => ({}) as never),
      postChannelMessage: vi.fn(async () => ({}) as never),
    };
    const selector = { kind: "organization" as const, channelId: "general" };
    await loadChannel(api, "22222222-2222-4222-8222-222222222222", selector, "11111111-1111-4111-8111-111111111111");
    await postChannelMessage(api, "22222222-2222-4222-8222-222222222222", selector, "11111111-1111-4111-8111-111111111111", "hello", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(api.getChannel).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", selector, { projectId: "11111111-1111-4111-8111-111111111111" });
    expect(api.postChannelMessage).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", selector, { projectId: "11111111-1111-4111-8111-111111111111", content: "hello" }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("reuses an idempotency command only for the unchanged retry-safe draft", () => {
    const first = createChannelMessageAttempt(" hello ");
    expect(createChannelMessageAttempt("hello", first)).toBe(first);
    expect(createChannelMessageAttempt("changed", first)).not.toBe(first);
    expect(createChannelMessageAttempt("changed", first).commandId).not.toBe(first.commandId);
  });
});
