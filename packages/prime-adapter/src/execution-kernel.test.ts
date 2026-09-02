import { describe, expect, it, vi } from "vitest";
import { ExecutionKernelUnavailableError } from "@maestro/domain";
import { createPrimeExecutionKernelFromFactory } from "./execution-kernel.js";

type FakeSession = {
  model?: { provider?: string; id?: string };
  runRlmChild: ReturnType<typeof vi.fn>;
  cancelRlmChildRun: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  getLastAssistantText: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
  disposeAsync: ReturnType<typeof vi.fn>;
  getRlmChildSnapshots: ReturnType<typeof vi.fn>;
  handleAgentMessageHostRequest: ReturnType<typeof vi.fn>;
};

function makeSession(): FakeSession {
  return {
    model: { provider: "prime", id: "kimi" },
    runRlmChild: vi.fn().mockResolvedValue({
      rlm_child_id: "prime-sdk-child-id-should-stay-private",
      name: "luna-child",
      session_dir: "/tmp/child",
      model: "prime/kimi",
    }),
    cancelRlmChildRun: vi.fn().mockReturnValue(true),
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue("ROOT_OK"),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    isStreaming: false,
    disposeAsync: vi.fn().mockResolvedValue(undefined),
    getRlmChildSnapshots: vi.fn().mockReturnValue([
      {
        id: "prime-sdk-child-id-should-stay-private",
        sessionName: "luna-child",
        status: "done",
        answerPreview: "LUNA_CHILD_OK",
        tokenCount: 42,
        activity: { kind: "executing", toolName: "ipython" },
      },
    ]),
    handleAgentMessageHostRequest: vi.fn().mockResolvedValue({ id: "message-1" }),
  };
}

describe("Prime execution-kernel adapter", () => {
  it("normalizes a named direct child observation without exposing SDK values", async () => {
    const session = makeSession();
    const kernel = createPrimeExecutionKernelFromFactory({
      create: vi.fn().mockResolvedValue({ session }),
    });

    const root = await kernel.spawn({ name: "luna-root", cwd: "/repo" });
    const child = await kernel.spawn({ name: "luna-child", parent: root.execution, prompt: "reply" });

    await expect(kernel.observe(root.execution)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        invocation: child.invocation,
        name: "luna-child",
        status: "succeeded",
        answer: { state: "available", text: "LUNA_CHILD_OK" },
      }),
    ]));
    await expect(kernel.getModelIdentity(root.execution)).resolves.toEqual({
      provider: "prime",
      id: "kimi",
    });
  });

  it("defaults an omitted root cwd to the current repository context", async () => {
    const session = makeSession();
    const factory = { create: vi.fn().mockResolvedValue({ session }) };
    const kernel = createPrimeExecutionKernelFromFactory(factory);

    await kernel.spawn({ name: "luna-root" });

    expect(factory.create).toHaveBeenCalledWith({ cwd: process.cwd() });
  });

  it("does not submit a root prompt during spawn and exposes the terminal root reply after prompt", async () => {
    const session = makeSession();
    const factory = { create: vi.fn().mockResolvedValue({ session }) };
    const kernel = createPrimeExecutionKernelFromFactory(factory);

    const root = await kernel.spawn({ name: "luna-root", cwd: "/repo", prompt: "ROOT_PROMPT" });
    expect(session.prompt).not.toHaveBeenCalled();
    await kernel.prompt(root.execution, "ROOT_PROMPT");

    expect(session.prompt).toHaveBeenCalledWith("ROOT_PROMPT");
    expect(await kernel.observe(root.execution)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invocation: root.invocation,
        status: "succeeded",
        answer: { state: "available", text: "ROOT_OK" },
      }),
    ]));
  });

  it("cancels an invocation once and treats later cancellation as already cancelled", async () => {
    const session = makeSession();
    const kernel = createPrimeExecutionKernelFromFactory({
      create: vi.fn().mockResolvedValue({ session }),
    });
    const root = await kernel.spawn({ name: "luna-root", cwd: "/repo" });
    const child = await kernel.spawn({ name: "luna-child", parent: root.execution, prompt: "reply" });

    await expect(kernel.cancel(child.invocation)).resolves.toEqual({ cancelled: true });
    await expect(kernel.cancel(child.invocation)).resolves.toEqual({ cancelled: false });
    expect(session.cancelRlmChildRun).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unsupported resume and reconnect", async () => {
    const kernel = createPrimeExecutionKernelFromFactory({ create: vi.fn() });

    await expect(kernel.resume("execution" as never)).rejects.toBeInstanceOf(
      ExecutionKernelUnavailableError,
    );
    await expect(kernel.reconnect("execution" as never)).rejects.toBeInstanceOf(
      ExecutionKernelUnavailableError,
    );
  });
});


  it("keeps SDK identifiers private and maps root status and cancellation", async () => {
    const session = makeSession();
    session.isStreaming = true;
    const kernel = createPrimeExecutionKernelFromFactory({
      create: vi.fn().mockResolvedValue({ session }),
    });

    const root = await kernel.spawn({ name: "luna-root", cwd: "/repo" });
    const child = await kernel.spawn({ name: "luna-child", parent: root.execution, prompt: "reply" });

    expect(root.invocation).not.toContain("prime-sdk");
    expect(child.invocation).not.toContain("prime-sdk");
    await expect(kernel.getInvocationStatus(root.invocation)).resolves.toBe("running");
    await expect(kernel.cancel(root.invocation)).resolves.toEqual({ cancelled: true });
    expect(session.abort).toHaveBeenCalledTimes(1);
    await expect(kernel.getInvocationStatus(root.invocation)).resolves.toBe("cancelled");
  });

  it("maps snapshot tool activity and usage without inventing missing values", async () => {
    const session = makeSession();
    const kernel = createPrimeExecutionKernelFromFactory({
      create: vi.fn().mockResolvedValue({ session }),
    });
    const root = await kernel.spawn({ name: "luna-root", cwd: "/repo" });
    const child = await kernel.spawn({ name: "luna-child", parent: root.execution, prompt: "reply" });

    expect((await kernel.observe(root.execution)).find((item) => item.invocation === child.invocation)).toMatchObject({
      toolEvents: {
        state: "available",
        events: [{ kind: "activity", toolName: "ipython", state: "executing" }],
      },
      usage: { state: "available", totalTokens: 42 },
    });
    await expect(kernel.getToolEvents(child.invocation)).resolves.toMatchObject({
      state: "available",
      events: [{ kind: "activity", toolName: "ipython", state: "executing" }],
    });
    await expect(kernel.getUsage(child.invocation)).resolves.toEqual({ state: "available", totalTokens: 42 });
    await expect(kernel.getToolEvents(root.invocation)).resolves.toEqual({
      state: "unavailable", reason: "provider-does-not-expose-tool-events",
    });
    await expect(kernel.getUsage(root.invocation)).resolves.toEqual({
      state: "unavailable", reason: "provider-does-not-expose-usage",
    });

    session.getRlmChildSnapshots.mockReturnValue([
      { id: "prime-sdk-child-id-should-stay-private", sessionName: "luna-child", status: "done" },
    ]);
    // The pinned SDK build does not always populate a completed child's
    // answerPreview; this must be reported honestly, never fabricated.
    expect((await kernel.observe(root.execution)).find((item) => item.invocation === child.invocation)).toMatchObject({
      toolEvents: { state: "unavailable", reason: "provider-does-not-expose-tool-events" },
      usage: { state: "unknown" },
      answer: { state: "unavailable", reason: "provider-does-not-expose-answer-text" },
    });
  });


describe("truthful unavailable Prime observations", () => {
  it("keeps root and a child without a snapshot observable without inventing status, events, or usage", async () => {
    const session = makeSession();
    session.getRlmChildSnapshots.mockReturnValue([]);
    const kernel = createPrimeExecutionKernelFromFactory({
      create: vi.fn().mockResolvedValue({ session }),
    });
    const root = await kernel.spawn({ name: "luna-root", cwd: "/repo" });
    const child = await kernel.spawn({ name: "luna-child", parent: root.execution, prompt: "reply" });

    await expect(kernel.getInvocationStatus(root.invocation)).resolves.toBe("unknown");
    await expect(kernel.getInvocationStatus(child.invocation)).resolves.toBe("unknown");
    await expect(kernel.getToolEvents(child.invocation)).resolves.toEqual({
      state: "unavailable", reason: "snapshot-unavailable",
    });
    await expect(kernel.getUsage(child.invocation)).resolves.toEqual({
      state: "unavailable", reason: "snapshot-unavailable",
    });
    await expect(kernel.observe(root.execution)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        invocation: root.invocation,
        name: "luna-root",
        status: "unknown",
        answer: { state: "unavailable", reason: "provider-does-not-expose-answer-text" },
      }),
      expect.objectContaining({
        invocation: child.invocation,
        name: "luna-child",
        status: "unknown",
        toolEvents: { state: "unavailable", reason: "snapshot-unavailable" },
        usage: { state: "unavailable", reason: "snapshot-unavailable" },
        answer: { state: "unavailable", reason: "snapshot-unavailable" },
      }),
    ]));
  });
});
