import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { cancelConversationTurn } from "./conversation-cancellation.js";

describe("conversation cancellation", () => {
  it("aborts locally, requests remote cancellation, and reports the result", async () => {
    const controller = new AbortController();
    const warnings: string[] = [];
    const client = {
      cancelConversation: vi.fn(async () => ({ conversationId: "conversation-1", status: "cancelled" })),
    } as unknown as Pick<ApiClient, "cancelConversation">;

    expect(
      cancelConversationTurn({
        controller,
        client,
        projectId: "project-1",
        conversationId: "conversation-1",
        onWarning: (message) => warnings.push(message),
        onError: vi.fn(),
      }),
    ).toBe(true);

    expect(controller.signal.aborted).toBe(true);
    expect(warnings).toEqual(["Cancelling the active conversation turn…"]);
    await vi.waitFor(() => expect(client.cancelConversation).toHaveBeenCalledWith("conversation-1", { projectId: "project-1" }));
  });

  it("reports remote cancellation failures without throwing", async () => {
    const onError = vi.fn();
    const client = {
      cancelConversation: vi.fn(async () => {
        throw new Error("offline");
      }),
    } as unknown as Pick<ApiClient, "cancelConversation">;

    expect(
      cancelConversationTurn({
        controller: new AbortController(),
        client,
        projectId: "project-1",
        conversationId: "conversation-1",
        onWarning: vi.fn(),
        onError,
      }),
    ).toBe(true);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Conversation cancellation unavailable: offline"));
  });
});
