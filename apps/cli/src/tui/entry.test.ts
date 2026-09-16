import { describe, expect, it, vi } from "vitest";
import { parseInput } from "./commands/parser.js";
import { executeCli } from "../main.js";
import { MAESTRO_VERSION } from "../version.js";
import {
  createAutomaticProviderSignInGate,
  handleConversationStreamEvent,
  applyHydratedConversation,
  createTranscriptClearBoundary,
  executeBasicShellCommand,
  latestCopyableTranscriptText,
  hydrateOrganizationOnReconnect,
  isProviderLoginActive,
  isSplashRestoreShortcut,
  isStartupCancellationInput,
  compactReviewAcknowledgement,
  compactHelpAcknowledgement,
  compactProjectAttachmentNotice,
  compactModelListAcknowledgement,
  firstAvailableModelIdentity,
  shouldHandoffAfterProviderLogin,
  isCurrentAccountLoginOperation,
  shouldDeferAutomaticProviderSignIn,
  shouldBlockConcurrentTurnSubmit,
  isCurrentConversationTurnController,
  compactConnectionRecoveryAcknowledgement,
  compactCommandResultAcknowledgement,
  compactTaskContractAcknowledgement,
  compactConversationAcknowledgement,
  shouldIgnoreEmptySubmit,
  shouldCancelPendingProviderLogin,
  shouldConsumePendingProviderLoginBackgroundInput,
  shouldRetryAutomaticProviderSignIn,
  shouldConsumeAccountLoginBackgroundInput,
  noModelSelectionMessage,
  runAutomaticProviderSignInOffer,
  shouldOfferAutomaticProviderSignIn,
  isAutomaticProviderSignInProjectEligible,
  taskContractDraftForConversation,
} from "./entry.js";
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

describe("automatic provider-login project eligibility", () => {
  it("requires an attached project", () => {
    expect(isAutomaticProviderSignInProjectEligible("unavailable")).toBe(false);
    expect(isAutomaticProviderSignInProjectEligible("attached")).toBe(true);
  });
});

describe("compact review presentation", () => {
  it("acknowledges both durable decisions and live approvals within the terminal width", () => {
    expect(
      compactReviewAcknowledgement(
        undefined,
        [{ identity: "decision-1", tier: "Encore Council", action: "deploy release", actor: "worker-2" }],
        80,
      ),
    ).toBe("Review: deploy release · 1 pending · ⏸ Encore Council");
    expect(
      compactReviewAcknowledgement({ action: "git push origin main", target: "origin/main", effect: "remote push", tier: "user" }, [], 80),
    ).toBe("Review: git push origin main · approval · You");
    expect(compactReviewAcknowledgement(undefined, [], 80)).toBeUndefined();
  });

  it("keeps the acknowledgement action-first and bounded on a narrow terminal", () => {
    const output = compactReviewAcknowledgement(
      undefined,
      [{ identity: "decision-1", tier: "Encore Council", action: "deploy release", actor: "worker-2" }],
      40,
    );
    expect(output).toContain("Review:");
    expect(output).toContain("deploy release");
    expect(output!.length).toBeLessThanOrEqual(40);
  });
});

describe("compact help feedback", () => {
  it("keeps the help result visible without claiming the hidden transcript is open", () => {
    for (const width of [40, 60, 80]) {
      const output = compactHelpAcknowledgement(width);
      expect(output).toBe("Help available; resize to view commands");
      expect(output.length).toBeLessThanOrEqual(width);
    }
  });
});

describe("compact connection recovery priority", () => {
  it("shows retry/help for every disconnected compact state and nothing when connected", () => {
    for (const connection of [
      { kind: "connecting" } as const,
      { kind: "setup-required", message: "configure endpoint" } as const,
      { kind: "error", message: "gateway unavailable" } as const,
    ]) {
      if (connection.kind === "setup-required") {
        expect(compactConnectionRecoveryAcknowledgement(connection, 40)).toContain("restart");
        expect(compactConnectionRecoveryAcknowledgement(connection, 80)).toContain("restart");
      } else {
        expect(compactConnectionRecoveryAcknowledgement(connection, 40)).toBe("ctrl+r retry · /help");
        expect(compactConnectionRecoveryAcknowledgement(connection, 80)).toBe("ctrl+r retry · /help");
      }
    }
    expect(compactConnectionRecoveryAcknowledgement({ kind: "connected" }, 40)).toBeUndefined();
  });
});

describe("compact command result presentation", () => {
  it("keeps ordinary command results bounded for the compact dock", () => {
    expect(compactCommandResultAcknowledgement("Goals: a very long result", 12)).toBe("Goals: a ve…");
    expect(compactCommandResultAcknowledgement("Goals: ok", 80)).toBe("Goals: ok");
  });
});

describe("concurrent conversation turn submission", () => {
  it("blocks only natural-language submits while a turn is active", () => {
    const controller = new AbortController();
    expect(shouldBlockConcurrentTurnSubmit("second", true, controller)).toBe(true);
    expect(shouldBlockConcurrentTurnSubmit("/help", true, controller)).toBe(false);
    expect(shouldBlockConcurrentTurnSubmit("second", false, undefined)).toBe(false);
    expect(shouldBlockConcurrentTurnSubmit("second", false, undefined, true)).toBe(true);
    expect(shouldBlockConcurrentTurnSubmit("/help", false, undefined, true)).toBe(false);
    expect(isCurrentConversationTurnController(controller, controller)).toBe(true);
    expect(isCurrentConversationTurnController(controller, undefined)).toBe(false);
  });
});

describe("automatic provider-login draft preservation", () => {
  it("defers only when the pending editor draft is non-empty", () => {
    expect(shouldDeferAutomaticProviderSignIn("hello")).toBe(true);
    expect(shouldDeferAutomaticProviderSignIn("  hello  ")).toBe(true);
    expect(shouldDeferAutomaticProviderSignIn("   ")).toBe(false);
    expect(shouldDeferAutomaticProviderSignIn("")).toBe(false);
  });
});

describe("account-login cancellation", () => {
  it("rejects aborted and stale opening operations", () => {
    const controller = new AbortController();
    expect(isCurrentAccountLoginOperation(controller, controller)).toBe(true);
    controller.abort();
    expect(isCurrentAccountLoginOperation(controller, controller)).toBe(false);

    const stale = new AbortController();
    const current = new AbortController();
    expect(isCurrentAccountLoginOperation(stale, current)).toBe(false);
  });
});

describe("account-login model handoff", () => {
  it("selects the first live catalog identity and leaves empty catalogs unresolved", () => {
    expect(firstAvailableModelIdentity([{ identity: { provider: "openai-codex", id: "gpt-5.3-codex" } }])).toBe("openai-codex/gpt-5.3-codex");
    expect(firstAvailableModelIdentity([])).toBeUndefined();
  });

  it("only hands off a model for a model-less session without a conversation", () => {
    expect(shouldHandoffAfterProviderLogin(undefined, undefined)).toBe(true);
    expect(shouldHandoffAfterProviderLogin("openai/gpt-5", undefined)).toBe(false);
    expect(shouldHandoffAfterProviderLogin(undefined, "conversation-1")).toBe(false);
  });
});

describe("compact model-list recovery", () => {
  it("shows a directly usable model selection command or truthful fallback", () => {
    expect(compactModelListAcknowledgement(["openai/gpt-5"], 40)).toBe("/model use --model openai/gpt-5");
    expect(compactModelListAcknowledgement(["anthropic/claude-sonnet-4-20250514"], 40)).toBe("anthropic/claude-sonnet-4-20250514");
    const wrapped = compactModelListAcknowledgement(["provider/" + "m".repeat(50)], 40);
    expect(wrapped.split("\n").every((line) => line.length <= 40)).toBe(true);
    expect(wrapped.replaceAll("\n", "")).toBe("provider/" + "m".repeat(50));
    expect(compactModelListAcknowledgement(["openai/gpt-5"], 80)).toContain("openai/gpt-5");
    expect(compactModelListAcknowledgement([], 40)).toBe("No models available · retry /models list");
    expect(compactModelListAcknowledgement([], 40, "Model catalog unavailable")).toBe("Catalog unavailable · retry /models");
  });
});

describe("account-login modal input capture", () => {
  it("consumes background input during opening and waiting except documented controls", () => {
    expect(shouldConsumeAccountLoginBackgroundInput("opening", false, false, false)).toBe(true);
    expect(shouldConsumeAccountLoginBackgroundInput("opening", false, true, false)).toBe(false);
    expect(shouldConsumeAccountLoginBackgroundInput("waiting", false, false, false)).toBe(true);
    expect(shouldConsumeAccountLoginBackgroundInput("waiting", false, true, false)).toBe(false);
    expect(shouldConsumeAccountLoginBackgroundInput("waiting", false, false, true)).toBe(false);
    expect(shouldConsumeAccountLoginBackgroundInput("waiting", true, false, false)).toBe(false);
    expect(shouldConsumeAccountLoginBackgroundInput("selecting", false, false, false)).toBe(false);
  });
});

describe("provider login cancellation", () => {
  it("only treats Escape as a provider-login cancel while a secret is pending", () => {
    expect(shouldCancelPendingProviderLogin("openai")).toBe(true);
    expect(shouldCancelPendingProviderLogin("anthropic")).toBe(true);
    expect(shouldCancelPendingProviderLogin(undefined)).toBe(false);
  });
});

describe("provider API-key modal input capture", () => {
  it("consumes global shortcuts without consuming secret editing input", () => {
    for (const data of ["\x01", "\x05", "\x07", "\x0b", "\x12", "\x1f"]) {
      expect(shouldConsumePendingProviderLoginBackgroundInput("openai", data)).toBe(true);
    }

    for (const data of ["h", "help", "\x7f", "\x1b[A", "\r", "\x1b", "\x03"]) {
      expect(shouldConsumePendingProviderLoginBackgroundInput("openai", data)).toBe(false);
    }
    expect(shouldConsumePendingProviderLoginBackgroundInput(undefined, "\x0b")).toBe(false);
  });
});

describe("empty conversation submit", () => {
  it("ignores blank normal submits but preserves provider-login input", () => {
    for (const text of ["", "   ", "\t\n"]) {
      expect(shouldIgnoreEmptySubmit(text, undefined)).toBe(true);
      expect(shouldIgnoreEmptySubmit(text, "openai")).toBe(false);
    }

    expect(shouldIgnoreEmptySubmit("hello", undefined)).toBe(false);
  });
});

describe("compact conversation output", () => {
  it("keeps streaming and terminal assistant outcomes bounded and visible", () => {
    const base = {
      messages: [],
      manualMessages: [],
      events: [],
      activeTurnId: "turn-1",
      assistantText: "The answer is ready.",
      status: "succeeded" as const,
      statusMessage: undefined,
      lastCursor: "1",
    };
    expect(compactConversationAcknowledgement({ ...base, status: "streaming", assistantText: "Partial answer" }, 40)).toContain("Partial answer");
    expect(compactConversationAcknowledgement(base, 80)).toContain("The answer is ready.");
    expect(compactConversationAcknowledgement({ ...base, assistantText: "", status: "failed", statusMessage: "gateway timeout" }, 40)).toContain("gateway timeout");
    expect(compactConversationAcknowledgement(base, 40).length).toBeLessThanOrEqual(40);
  });
});

describe("compact task contract guidance", () => {
  it("keeps resize and both exact actions visible in bounded rows", () => {
    const lines = compactTaskContractAcknowledgement(40).split("\n");
    expect(lines).toEqual(["Task contract ready · resize to review", "/task-contract confirm", "/task-contract launch"]);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });
});

describe("compact project attachment guidance", () => {
  it("keeps the executable attach command visible while discovery is unresolved", () => {
    const notice = "Multiple projects are available; choose one: /session attach --project-index=1 or /session attach --project-index=2";

    expect(compactProjectAttachmentNotice(notice, 40)).toBe("/session attach --project-index=1");
    expect(compactProjectAttachmentNotice(notice, 80)).toBe("/session attach --project-index=1");
    expect(compactProjectAttachmentNotice("Project discovery unavailable: gateway timeout", 40)).toBe("Discovery failed · ctrl+r retry");
    expect(compactProjectAttachmentNotice(undefined, 40)).toBe("/session attach");
  });
});

describe("no-model first-turn guidance", () => {
  it("gives a first-time user an in-session model selection path", () => {
    const lines = noModelSelectionMessage().split("\n");

    expect(lines).toEqual([
      "No model selected.",
      "Run /models list.",
      "If a model is available, run:",
      "/model use --model provider/model",
      "Set MAESTRO_MODEL before a new session.",
    ]);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
    expect(lines.join(" ")).toContain("/models list");
    expect(lines.join(" ")).toContain("/model use --model provider/model");
    expect(lines.join(" ")).toContain("MAESTRO_MODEL");
  });
});

describe("hydrated conversation application", () => {
  it("assigns hydrated state and keeps rendering delegated to the existing draft callback", () => {
    const hydrated = createConversationTranscript();
    const setConversation = vi.fn();
    const setDraft = vi.fn();
    const showDraft = vi.fn();

    applyHydratedConversation(hydrated, undefined, { setConversation, setDraft, showDraft });

    expect(setConversation).toHaveBeenCalledWith(hydrated);
    expect(setDraft).not.toHaveBeenCalled();
    expect(showDraft).not.toHaveBeenCalled();
  });
});

describe("conversation stream event handling", () => {
  it("applies, dismisses the splash, renders, and classifies terminal events in order", () => {
    const order: string[] = [];
    let conversation = createConversationTranscript();
    conversation = applyConversationEvent(conversation, {
      cursor: "1",
      eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04",
      conversationId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
      projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01",
      occurredAt: "2030-01-01T00:00:00.000Z",
      eventType: "turn_started",
      payload: { turnId: "turn-1", text: "question" },
    });
    conversation = applyConversationEvent(conversation, {
      cursor: "2",
      eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05",
      conversationId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
      projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01",
      occurredAt: "2030-01-01T00:00:00.000Z",
      eventType: "turn_delta",
      payload: { turnId: "turn-1", text: "answer" },
    });
    let compactOutcome: ConversationTranscriptState | undefined;
    const result = handleConversationStreamEvent({
      conversation,
      event: {
        cursor: "3",
        eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04",
        conversationId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
        projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01",
        occurredAt: "2030-01-01T00:00:00.000Z",
        eventType: "turn_completed",
        payload: { turnId: "turn-1", status: "succeeded" },
      },
      dismissSplash: () => order.push("dismiss"),
      onCompactOutcome: (nextConversation) => {
        compactOutcome = nextConversation;
        order.push("compact");
      },
      render: () => order.push("render"),
    });

    expect(result.terminal).toBe(true);
    expect(result.conversation.status).toBe("succeeded");
    expect(compactOutcome?.assistantText).toBe("answer");
    expect(order).toEqual(["dismiss", "compact", "render"]);
  });
});

describe("organization hydration on reconnect", () => {
  it("refreshes the visible organization state after a successful connection retry", async () => {
    const state: Pick<TuiShellState, "organization"> = { organization: { kind: "empty" } };
    await hydrateOrganizationOnReconnect(state, {
      getOrganization: async () => ({
        groups: [{ groupId: "product", displayName: "Product Group" }],
        departments: [
          {
            departmentId: "product",
            groupId: "product",
            displayName: "Product Department",
            status: "sleeping",
            activeSessionId: null,
            goalContext: null,
          },
        ],
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

  it("does not consume the offer gate while the project is unattached", async () => {
    const gate = createAutomaticProviderSignInGate();
    const listModels = vi.fn(async () => []);
    const onOffer = vi.fn();
    await runAutomaticProviderSignInOffer({
      client: { listModels },
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => false,
      isManualLoginActive: () => false,
      onOffer,
    });
    expect(listModels).not.toHaveBeenCalled();
    await runAutomaticProviderSignInOffer({
      client: { listModels },
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => true,
      isManualLoginActive: () => false,
      onOffer,
    });
    expect(onOffer).toHaveBeenCalledOnce();
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
      client: {
        listModels: () =>
          new Promise<readonly []>((resolve) => {
            resolveModels = resolve;
          }),
      },
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
      client: {
        listModels: () =>
          new Promise<readonly []>((resolve) => {
            resolveModels = resolve;
          }),
      },
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

  it("does not consume the offer gate when the chooser cannot fit", async () => {
    const gate = createAutomaticProviderSignInGate();
    const onOffer = vi.fn();
    let canRender = false;
    const options = {
      client: { listModels: async () => [] },
      getConfiguredModel: () => undefined,
      gate,
      isCurrent: () => true,
      isManualLoginActive: () => false,
      canOffer: () => canRender,
      onOffer,
    };

    await runAutomaticProviderSignInOffer(options);
    expect(onOffer).not.toHaveBeenCalled();
    canRender = true;
    await runAutomaticProviderSignInOffer(options);
    expect(onOffer).toHaveBeenCalledOnce();
  });

  it("retries only when terminal height crosses the chooser threshold", () => {
    expect(shouldRetryAutomaticProviderSignIn(7, 8)).toBe(true);
    expect(shouldRetryAutomaticProviderSignIn(8, 9)).toBe(false);
    expect(shouldRetryAutomaticProviderSignIn(7, 7)).toBe(false);
    expect(shouldRetryAutomaticProviderSignIn(16, 7)).toBe(false);
  });

  it("does not consume the offer gate when model discovery fails", async () => {
    let unavailable = true;
    const onOffer = vi.fn();
    const client = {
      listModels: vi.fn(async () => {
        if (unavailable) throw new Error("gateway unavailable");
        return [];
      }),
    };
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

describe("startup cancellation input", () => {
  it("recognizes Ctrl+C and Escape without consuming ordinary input", () => {
    expect(isStartupCancellationInput("\u0003")).toBe(true);
    expect(isStartupCancellationInput("\u001b")).toBe(true);
    expect(isStartupCancellationInput("a")).toBe(false);
  });
});

describe("Task Contract draft display boundary", () => {
  const validDraft = JSON.stringify({
    contractId: "33333333-3333-4333-8333-333333333333",
    schemaVersion: 1,
    version: 1,
    desiredOutcome: "Ship the intake",
    userVisibleBehavior: ["A brief is accepted"],
    successCriteria: ["A durable contract exists"],
    liveEvidence: ["Contract row"],
    scope: ["Project only"],
    nonGoals: ["No workers yet"],
    priorities: ["Safety"],
    acceptableTradeoffs: ["Ask when unclear"],
    constraints: ["No execution before approval"],
    knownEdgeCases: ["Vague brief"],
    project: {
      projectId: "11111111-1111-4111-8111-111111111111",
      repository: "/repo",
      immutableBaseRevision: "abc",
      dataBoundary: "project only",
    },
    evidenceReferences: ["brief"],
    approvedPreviewReferences: [],
    expectedGroups: [],
    expectedDepartments: [],
    criticalActionExpectations: ["Explicit confirmation"],
    forbiddenEffects: ["Worker spawn"],
    environmentAssumptions: ["Control Plane"],
    externalServiceAssumptions: [],
    budget: { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["Stop at ceiling"] },
    decisionHistory: [],
    contentHash: "a".repeat(64),
    launchState: "awaiting_confirmation",
  });

  it("keeps Goal-bound live-turn JSON as ordinary chat content", () => {
    expect(taskContractDraftForConversation(validDraft, "goal-1")).toBeUndefined();
  });

  it("keeps Goal-bound hydrated-history JSON as ordinary chat content", () => {
    expect(taskContractDraftForConversation(validDraft, "goal-1")).toBeUndefined();
  });

  it("accepts the durable draft for goal-less live and hydrated conversation content", () => {
    expect(taskContractDraftForConversation(validDraft, undefined)).toMatchObject({ contractId: "33333333-3333-4333-8333-333333333333" });
    expect(taskContractDraftForConversation(validDraft, null)).toMatchObject({ launchState: "awaiting_confirmation" });
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
    const context = basicShellContext({
      clearTranscript: () => {
        state.visibleTranscript = [];
      },
    });
    await executeBasicShellCommand("clear", context);
    expect(state.visibleTranscript).toEqual([]);
    expect({ connection: state.connection, session: state.session, selectedGoal: state.selectedGoal, durable: state.durable }).toEqual(
      before,
    );
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
      cursor: "1",
      eventId: "event-1",
      conversationId: "conversation-1",
      projectId: "project-1",
      eventType: "turn_started",
      payload: { turnId: "turn-1", text: "question" },
      occurredAt: "2020-01-01T00:00:00.000Z",
    });
    conversation = applyConversationEvent(conversation, {
      cursor: "2",
      eventId: "event-2",
      conversationId: "conversation-1",
      projectId: "project-1",
      eventType: "turn_completed",
      payload: { turnId: "turn-1", content: "assistant response" },
      occurredAt: "2020-01-01T00:00:01.000Z",
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

    const unavailable = basicShellContext({
      copyToClipboard: vi.fn(async () => {
        throw new Error("unavailable");
      }),
    });
    await executeBasicShellCommand("copy", unavailable);
    expect(unavailable.write).toHaveBeenCalledWith("Clipboard unavailable. Copy this transcript line: assistant response");
  });
});
