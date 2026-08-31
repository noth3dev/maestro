import { expect, test } from "vitest";
import { createAgentSession, SessionManager } from "prime-agent";

const runLive = process.env.MAESTRO_LIVE_PRIME === "1";

test.skipIf(!runLive)(
  "runs a root prompt and a direct child through the public SDK",
  async () => {
    const cwd = process.cwd();
    const { session } = await createAgentSession({
      cwd,
      sessionManager: SessionManager.inMemory(cwd),
      rlmMaxDepth: 1,
    });
    let rootText = "";
    let childOff: () => void = () => undefined;
    let childTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        rootText += event.assistantMessageEvent.delta;
      }
    });

    try {
      await session.prompt(
        "Reply with exactly LUNA_ROOT_OK. Do not call tools or add punctuation.",
      );
      expect(rootText).toContain("LUNA_ROOT_OK");
      expect(session.model?.provider).toBeTruthy();
      expect(session.model?.id).toBeTruthy();

      const childAnswer = new Promise<string>((resolve, reject) => {
        childTimer = setTimeout(() => {
          childOff();
          reject(new Error("Timed out waiting for Prime Agent child"));
        }, 120_000);
        childOff = session.subscribe((event) => {
          if (event.type !== "rlm_child_update") return;
          if (event.child.sessionName !== "luna-sdk-child") return;
          if (event.child.status === "done") {
            if (childTimer) clearTimeout(childTimer);
            childOff();
            resolve(event.child.answerPreview ?? "");
          } else if (event.child.status === "error") {
            if (childTimer) clearTimeout(childTimer);
            childOff();
            reject(new Error(event.child.error ?? "Prime Agent child failed"));
          }
        });
      });

      const handle = await session.runRlmChild(
        "Reply with exactly LUNA_CHILD_OK. Do not call tools or add punctuation.",
        { name: "luna-sdk-child", thinking: "off" },
      );
      expect(handle.rlm_child_id).toBeTruthy();
      await expect(childAnswer).resolves.toContain("LUNA_CHILD_OK");
    } finally {
      if (childTimer) clearTimeout(childTimer);
      childOff();
      unsubscribe();
      if (session.isStreaming) await session.abort();
      await session.disposeAsync();
    }
  },
  180_000,
);
