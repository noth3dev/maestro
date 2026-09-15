import { describe, expect, it, vi } from "vitest";
import { parseInput } from "./commands/parser.js";
import { executeCli } from "../main.js";
import { MAESTRO_VERSION } from "../version.js";
import { createAutomaticProviderSignInGate, createTranscriptClearBoundary, executeBasicShellCommand, latestCopyableTranscriptText, hydrateOrganizationOnReconnect, isProviderLoginActive, isSplashRestoreShortcut, runAutomaticProviderSignInOffer, shouldOfferAutomaticProviderSignIn } from "./entry.js";
import type { TuiShellState } from "./components/shell.js";
import { addConversationMessage, applyConversationEvent, createConversationTranscript } from "./conversation-transcript.js";

const basicShellContext = (overrides: Partial<Parameters<typeof executeBasicShellCommand>[1]> = {}) => ({
  clearTranscript: vi.fn(),
  stop: vi.fn(),
  getLatestTranscriptText: vi.fn(() => "assistant response"),
  copyToClipboard: vi.fn(async () => undefined),
  write: vi.fn(),
  version: "maestro development",
  ...overrides,
});

const model = (provider: string, id: string) => ({
  identity: { provider, id },
  capabilities: ["text"],
  authModes: ["api-key" as const],
  dataPolicy: {
    allowedDataClasses: ["public" as const],
    retention: "none" as const,
    trainsOnCustomerData: false,
    regions: ["US"],
  },
});

describe("organization hydration on reconnect", () => {
  it("refreshes the visible organization state after a successful connection retry", async () => {
    const state: Pick<TuiShellState, "organization"> = { organization: { kind: "empty" } };
    await hydrateOrganizationOnReconnect(state, {
      getOrganization: async () => ({
        groups: [{ groupId: "product", displayName: "Product Group" }],
        departments: [{ departmentId: "product", groupId: "product", displayName: "Product Department", status: "sleeping", activeSessionId: null, goalContext: null }],
      }),
    });
    expect(state.organization).toEqual({ kind: "value", value: { departments: ["Product Department"] } });
  });
});

describe("automatic provider sign-in", () => {
  it("offers sign-in when no model/provider credential is resolvable", () => {
    expect(shouldOfferAutomaticProviderSignIn([], undefined)).toBe(true);
    expect(shouldOfferAutomaticProviderSignIn([model("openai", "gpt-5")], "openai/unknown")).toBe(true);
  });

  it("does not offer sign-in when the session or environment model is available", () => {
    expect(shouldOfferAutomaticProviderSignIn([model("openai", "gpt-5")], "openai/gpt-5")).toBe(false);
  });

  it("enters the account sign-in flow from a connected empty catalog without a keypress", async () => {
    const onOffer = vi.fn();
    await runAutomaticProviderSignInOffer({
      client: { listModels: async () => [] },
      getConfiguredModel: () => undefined,
      gate: createAutomaticProviderSignInGate(),
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    });
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("claims the automatic offer only once, including after dismissal", async () => {
    const gate = createAutomaticProviderSignInGate();
    const onOffer = vi.fn();
    const options = {
      client: { listModels: async () => [] },
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    };
    await runAutomaticProviderSignInOffer(options);
    await runAutomaticProviderSignInOffer(options);
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("keeps automatic offers blocked while a provider-key request is in flight", () => {
    expect(isProviderLoginActive(undefined, true, undefined)).toBe(true);
    expect(isProviderLoginActive("openai", false, undefined)).toBe(true);
    expect(isProviderLoginActive(undefined, false, 0)).toBe(true);
    expect(isProviderLoginActive(undefined, false, undefined)).toBe(false);
  });

  it("does not overwrite manual provider-key entry or a stale connection", async () => {
    let resolveModels: ((models: readonly []) => void) | undefined;
    let manualLoginActive = false;
    let loginInteractionGeneration = 0;
    const manualGeneration = loginInteractionGeneration;
    const manualOffer = vi.fn();
    const manualRequest = runAutomaticProviderSignInOffer({
      client: { listModels: () => new Promise<readonly []>((resolve) => { resolveModels = resolve; }) },
      getConfiguredModel: () => undefined,
      gate: createAutomaticProviderSignInGate(),
      isCurrent: () => loginInteractionGeneration === manualGeneration,
      isManualLoginActive: () => manualLoginActive,
      onOffer: manualOffer,
    });
    manualLoginActive = true;
    loginInteractionGeneration += 1;
    manualLoginActive = false;
    resolveModels!([]);
    await manualRequest;
    expect(manualOffer).not.toHaveBeenCalled();

    let current = true;
    resolveModels = undefined;
    const staleOffer = vi.fn();
    const staleRequest = runAutomaticProviderSignInOffer({
      client: { listModels: () => new Promise<readonly []>((resolve) => { resolveModels = resolve; }) },
      getConfiguredModel: () => undefined,
      gate: createAutomaticProviderSignInGate(),
      isCurrent: () => current,
      isManualLoginActive: () => false,
      onOffer: staleOffer,
    });
    current = false;
    resolveModels!([]);
    await staleRequest;
    expect(staleOffer).not.toHaveBeenCalled();
  });

  it("does not consume the offer gate when model discovery fails", async () => {
    let unavailable = true;
    const onOffer = vi.fn();
    const client = { listModels: vi.fn(async () => { if (unavailable) throw new Error("gateway unavailable"); return []; }) };
    const gate = createAutomaticProviderSignInGate();
    const options = {
      client,
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    };
    await runAutomaticProviderSignInOffer(options);
    unavailable = false;
    await runAutomaticProviderSignInOffer(options);
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("leaves the explicit /login command available", () => {
    expect(parseInput("/login")).toEqual({ kind: "command", name: "login", options: {} });
  });

  it("recognizes the legacy raw Ctrl+/ byte used by ordinary terminals", () => {
    expect(isSplashRestoreShortcut("\x1f")).toBe(true);
  });
});


describe("basic shell command boundaries", () => {
  it("clears visible transcript without changing connection, session, selected Goal, or durable fields", async () => {
    const state = {
      visibleTranscript: ["old assistant line"],
      connection: { kind: "connected" as const },
      session: { sessionId: "session-1", goalId: "goal-1" },
      selectedGoal: "goal-1",
      durable: { serverState: "unchanged" },
    };
    const before = { connection: state.connection, session: state.session, selectedGoal: state.selectedGoal, durable: state.durable };
    const context = basicShellContext({ clearTranscript: () => { state.visibleTranscript = []; } });
    await executeBasicShellCommand("clear", context);
    expect(state.visibleTranscript).toEqual([]);
    expect({ connection: state.connection, session: state.session, selectedGoal: state.selectedGoal, durable: state.durable }).toEqual(before);
  });

  it("connects the clear command context to the hydration boundary", async () => {
    const boundary = createTranscriptClearBoundary();
    const hydrationGeneration = boundary.capture();
    await executeBasicShellCommand("clear", basicShellContext({ clearTranscript: boundary.clear }));
    expect(boundary.isCurrent(hydrationGeneration)).toBe(false);
    expect(boundary.isCurrent(boundary.capture())).toBe(true);
  });

  it("copies the latest transcript line in sequence, including multiline and empty lines", async () => {
    let conversation = createConversationTranscript();
    conversation = applyConversationEvent(conversation, {
      cursor: "1", eventId: "event-1", conversationId: "conversation-1", projectId: "project-1",
      eventType: "turn_started", payload: { turnId: "turn-1", text: "question" }, occurredAt: "2020-01-01T00:00:00.000Z",
    });
    conversation = applyConversationEvent(conversation, {
      cursor: "2", eventId: "event-2", conversationId: "conversation-1", projectId: "project-1",
      eventType: "turn_completed", payload: { turnId: "turn-1", content: "assistant response" }, occurredAt: "2020-01-01T00:00:01.000Z",
    });
    conversation = addConversationMessage(conversation, "system", "system after assistant\nsecond line");
    expect(latestCopyableTranscriptText(conversation)).toBe("system after assistant\nsecond line");
    const context = basicShellContext({ getLatestTranscriptText: () => latestCopyableTranscriptText(conversation) });
    await executeBasicShellCommand("copy", context);
    expect(context.copyToClipboard).toHaveBeenCalledWith("system after assistant\nsecond line");
    expect(latestCopyableTranscriptText(addConversationMessage(conversation, "system", "   "))).toBe("system after assistant\nsecond line");
  });

  it("reports when copy has no non-empty assistant or system transcript", async () => {
    const context = basicShellContext({ getLatestTranscriptText: () => undefined });
    await executeBasicShellCommand("copy", context);
    expect(context.copyToClipboard).not.toHaveBeenCalled();
    expect(context.write).toHaveBeenCalledWith("No transcript text to copy.");
  });

  it("uses exactly the same version text as executeCli --version", async () => {
    const output: string[] = [];
    await executeCli(["--version"], {}, { stdout: (text) => output.push(text), stderr: () => undefined });
    expect(output.join("").trim()).toBe(MAESTRO_VERSION);
    const context = basicShellContext({ version: MAESTRO_VERSION });
    await executeBasicShellCommand("version", context);
    expect(context.write).toHaveBeenCalledWith(output.join("").trim());
  });
});


describe("basic shell commands", () => {
  it("clears only the visible transcript through the supplied local callback", async () => {
    const context = basicShellContext();
    await expect(executeBasicShellCommand("clear", context)).resolves.toBe(true);
    expect(context.clearTranscript).toHaveBeenCalledOnce();
    expect(context.stop).not.toHaveBeenCalled();
  });

  it("routes exit and quit through the existing stop callback", async () => {
    for (const command of ["exit", "quit"] as const) {
      const context = basicShellContext();
      await expect(executeBasicShellCommand(command, context)).resolves.toBe(true);
      expect(context.stop).toHaveBeenCalledOnce();
    }
  });

  it("writes the shared CLI version", async () => {
    const context = basicShellContext();
    await expect(executeBasicShellCommand("version", context)).resolves.toBe(true);
    expect(context.write).toHaveBeenCalledWith("maestro development");
  });

  it("copies the latest transcript and prints it when clipboard access fails", async () => {
    const copied = basicShellContext();
    await executeBasicShellCommand("copy", copied);
    expect(copied.copyToClipboard).toHaveBeenCalledWith("assistant response");

    const unavailable = basicShellContext({ copyToClipboard: vi.fn(async () => { throw new Error("unavailable"); }) });
    await executeBasicShellCommand("copy", unavailable);
    expect(unavailable.write).toHaveBeenCalledWith("Clipboard unavailable. Copy this transcript line: assistant response");
  });
});
