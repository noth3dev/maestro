import type { ApiClient } from "@maestro/api-client";
import type { ConversationActivityEvent } from "@maestro/contracts";

export type ConversationActivityView = Pick<ConversationActivityEvent, "phase" | "toolName" | "status">;

export function activityView(event: ConversationActivityEvent): ConversationActivityView {
  return {
    phase: event.phase,
    ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
    ...(event.status === undefined ? {} : { status: event.status }),
  };
}

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Best-effort live activity. It intentionally has no cursor: reconnect starts a fresh snapshot. */
export async function runConversationActivityStream(options: {
  client: Pick<ApiClient, "streamConversationActivity">;
  conversationId: string;
  projectId: string;
  signal: AbortSignal;
  onEvent: (event: ConversationActivityEvent) => void;
  onReset?: () => void;
}): Promise<void> {
  let failures = 0;
  while (!options.signal.aborted) {
    try {
      for await (const event of options.client.streamConversationActivity(
        options.conversationId,
        { projectId: options.projectId },
        { signal: options.signal },
      )) {
        if (options.signal.aborted) return;
        failures = 0;
        options.onEvent(event);
      }
      if (options.signal.aborted) return;
      throw new Error("conversation activity stream ended");
    } catch {
      if (options.signal.aborted) return;
      failures += 1;
      options.onReset?.();
      await waitForReconnect(options.signal, Math.min(2_000, 100 * 2 ** Math.min(failures, 5)));
    }
  }
}
