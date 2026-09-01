import { expect, test } from "vitest";
import { ExecutionKernelUnavailableError } from "@maestro/domain";
import { createPrimeExecutionKernel } from "./execution-kernel.js";

const runLive = process.env.MAESTRO_LIVE_PRIME === "1";

async function waitForChildReply(
  kernel: ReturnType<typeof createPrimeExecutionKernel>,
  execution: Parameters<ReturnType<typeof createPrimeExecutionKernel>["observe"]>[0],
  invocation: Parameters<ReturnType<typeof createPrimeExecutionKernel>["cancel"]>[0],
): Promise<Awaited<ReturnType<ReturnType<typeof createPrimeExecutionKernel>["observe"]>>[number]> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = (await kernel.observe(execution)).find((item) => item.invocation === invocation);
    if (result?.status === "succeeded" || result?.status === "failed" || result?.status === "cancelled") {
      return result;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for normalized Prime Agent child result");
}

test.skipIf(!runLive)(
  "runs a parent and named direct child through the execution-kernel port",
  async () => {
    const kernel = createPrimeExecutionKernel();
    const root = await kernel.spawn({ name: "luna-sdk-root", cwd: process.cwd() });
    await kernel.prompt(root.execution, "Reply with exactly LUNA_ROOT_OK. Do not call tools or add punctuation.");

    const child = await kernel.spawn({
      parent: root.execution,
      name: "luna-sdk-child",
      // A direct child's terminal answer is only captured when it explicitly
      // replies to its parent; simply finishing does not populate it.
      prompt: 'Immediately call agent_message.send(message="LUNA_CHILD_OK", receiver_role="parent") with exactly that text and nothing else, then stop.',
    });
    const observation = await waitForChildReply(kernel, root.execution, child.invocation);

    expect(observation).toMatchObject({
      invocation: child.invocation,
      name: "luna-sdk-child",
      status: "succeeded",
    });
    // This pinned Prime Agent SDK build does not reliably expose a completed
    // child's reply text through the bound in-process session surface. The
    // kernel must report that honestly rather than fabricate an answer; it
    // must never silently report a fabricated or stale value.
    if (observation.answer.state === "available") {
      expect(observation.answer.text).toContain("LUNA_CHILD_OK");
    } else {
      expect(observation.answer).toEqual({ state: "unavailable", reason: "provider-does-not-expose-answer-text" });
      console.info("Prime child answer text unavailable through this SDK build", observation.answer);
    }

    try {
      const model = await kernel.getModelIdentity(root.execution);
      expect(model.provider).toBeTruthy();
      expect(model.id).toBeTruthy();
      console.info("Prime model identity", model);
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionKernelUnavailableError);
      console.info("Prime model identity unavailable", error);
    }
  },
  180_000,
);
