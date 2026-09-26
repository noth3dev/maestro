import { describe, expect, it } from "vitest";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import { ToolRegistry } from "@maestro/agent-runtime";
import { createOvertureRoleTurnRunner } from "./overture-role-turn.js";

const ids = {
  operatorMessageId: "66666666-6666-4666-8666-666666666666",
  runId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  conversationId: "33333333-3333-4333-8333-333333333333",
  turnId: "44444444-4444-4444-8444-444444444444",
};

describe("Overture role turn runner", () => {
  it("records the selected model before admission and persists the bounded role answer", async () => {
    const order: string[] = [];
    let gatewayClosed = false;
    const appended: Array<Record<string, unknown>> = [];
    const gateway = {
      listModels: async () => [],
      admit: async (request) => {
        order.push("admit");
        expect(request).toMatchObject({ providerId: "anthropic", accountRef: "anthropic-operator-1" });
        return {
          bindingId: "binding-1",
          gatewayInstanceId: "gateway-1",
          provider: { provider: "anthropic", id: "claude-3-5-sonnet" },
          account: { providerId: "anthropic", accountRef: "anthropic-operator-1", authMode: "managed-subscription" as const },
          dataPolicyHash: "policy-1",
        };
      },
      turn: async (request) => {
        request.emit({ kind: "text-delta", cursor: 1, text: "bounded answer" });
        request.emit({ kind: "terminal", cursor: 2, status: "succeeded" });
        return {
          requestId: request.requestId,
          model: { provider: "anthropic", id: "claude-3-5-sonnet" },
          text: "bounded answer",
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { state: "unknown" as const },
        };
      },
      cancel: async () => ({ state: "confirmed" as const }),
      recover: async () => "reconnected" as const,
      close: async () => {
        gatewayClosed = true;
      },
    } satisfies ModelGatewayPort;
    const runner = createOvertureRoleTurnRunner({
      gateway,
      gatewayOperatorId: "operator-1",
      accountRefs: { anthropic: "anthropic-operator-1" },
      dataPolicyHash: "policy-1",
      tools: new ToolRegistry(),
      readModel: async () => {
        order.push("read-model");
        return { provider: "anthropic", id: "claude-3-5-sonnet" };
      },
      readMessages: async () => [],
      bindRoleModel: async (input) => {
        order.push(`bind:${input.modelRef}`);
      },
      appendRoleMessage: async (input) => {
        appended.push(input);
        return {
          messageId: "55555555-5555-4555-8555-555555555555",
          runId: input.runId,
          conversationId: input.conversationId,
          projectId: input.projectId,
          turnId: input.turnId,
          cursor: "2",
          actor: input.actor,
          modelRef: input.modelRef,
          content: input.content,
          createdAt: "2026-09-23T00:00:00.000Z",
        };
      },
    });

    const result = await runner.run({ ...ids, operatorId: "operator-1", content: "Please assess this scope." });

    expect(order).toEqual(["read-model", "bind:anthropic/claude-3-5-sonnet", "admit"]);
    expect(result.content).toBe("bounded answer");
    expect(gatewayClosed).toBe(false);
    expect(appended[0]).toMatchObject({
      runId: ids.runId,
      projectId: ids.projectId,
      conversationId: ids.conversationId,
      turnId: ids.turnId,
      actor: "conversation-lead",
      modelRef: "anthropic/claude-3-5-sonnet",
      content: "bounded answer",
    });
  });
});

describe("Overture crew conversation", () => {
  const roles = ["conversation-lead", "architecture-analyst", "external-research-scout", "security-evaluator", "design-mock-specialist", "task-editor"] as const;

  function crewRunner(replyFor: (speaker: string) => string) {
    const appended: Array<{ actor: string; content: string }> = [];
    const gateway = {
      listModels: async () => [],
      admit: async () => ({
        bindingId: `binding-${Math.random()}`,
        gatewayInstanceId: "gateway-1",
        provider: { provider: "anthropic", id: "claude-3-5-sonnet" },
        account: { providerId: "anthropic", accountRef: "anthropic-operator-1", authMode: "managed-subscription" as const },
        dataPolicyHash: "policy-1",
      }),
      turn: async (request) => {
        const system = request.messages
          .filter((message) => message.role === "system")
          .flatMap((message) => message.content.map((part) => ("text" in part ? part.text : "")))
          .join(" ");
        const speaker = system.includes("You coordinate an Overture planning crew") ? "triage" : (/You are the (.+?) in an interactive Overture Crew/.exec(system)?.[1] ?? "unknown");
        const text = replyFor(speaker);
        request.emit({ kind: "text-delta", cursor: 1, text });
        request.emit({ kind: "terminal", cursor: 2, status: "succeeded" });
        return { requestId: request.requestId, model: { provider: "anthropic", id: "claude-3-5-sonnet" }, text, toolCalls: [], stopReason: "end_turn" as const, usage: { state: "unknown" as const } };
      },
      cancel: async () => ({ state: "confirmed" as const }),
      recover: async () => "reconnected" as const,
      close: async () => undefined,
    } satisfies ModelGatewayPort;
    const runner = createOvertureRoleTurnRunner({
      gateway,
      gatewayOperatorId: "operator-1",
      accountRefs: { anthropic: "anthropic-operator-1" },
      dataPolicyHash: "policy-1",
      tools: new ToolRegistry(),
      readModel: async () => ({ provider: "anthropic", id: "claude-3-5-sonnet" }),
      readMessages: async () => [],
      bindRoleModel: async () => undefined,
      appendRoleMessage: async (input) => {
        appended.push({ actor: input.actor, content: input.content });
        return { messageId: `m-${appended.length}`, runId: input.runId, conversationId: input.conversationId, projectId: input.projectId, turnId: input.turnId, cursor: String(appended.length), actor: input.actor, modelRef: input.modelRef, content: input.content, createdAt: "2026-09-26T00:00:00.000Z" };
      },
    });
    return { runner, appended };
  }

  it("lets addressed and volunteering crew members join, and crew members address each other", async () => {
    const { runner, appended } = crewRunner((speaker) => {
      if (speaker === "Conversation Lead") return "Plan drafted. @design please mock the sign-up screen.";
      if (speaker === "triage") return '{"roles":[{"role":"security-evaluator","reason":"the form collects emails"}]}';
      if (speaker === "Design and Mock Specialist") return "Mock written to design/signup.html. @security can you check the form?";
      if (speaker === "Security Evaluator") return "Store emails only after consent. @task please add that to task.md.";
      if (speaker === "Task Editor") return "Added the consent requirement to task.md.";
      return "unexpected";
    });
    await runner.runCrew!({ ...ids, operatorId: "operator-1", content: "Plan a sign-up page", assignedRoles: roles });
    // The round closes with the lead's summary.
    expect(appended.map((message) => message.actor)).toEqual(["conversation-lead", "design-mock-specialist", "security-evaluator", "task-editor", "conversation-lead"]);
  });

  it("keeps the lead alone for small talk and bounds crew-to-crew ping-pong", async () => {
    const quiet = crewRunner((speaker) => (speaker === "triage" ? '{"roles":[]}' : "Thanks!"));
    await quiet.runner.runCrew!({ ...ids, operatorId: "operator-1", content: "thanks", assignedRoles: roles });
    expect(quiet.appended.map((message) => message.actor)).toEqual(["conversation-lead"]);

    const noisy = crewRunner((speaker) => (speaker === "triage" ? "not json" : speaker === "Security Evaluator" ? "@design again?" : "@security what do you think?"));
    await noisy.runner.runCrew!({ ...ids, operatorId: "operator-1", content: "@design start", assignedRoles: roles });
    // Eight crew replies plus the lead's closing summary.
    expect(noisy.appended.length).toBe(9);
  });
});

describe("crew addressing", () => {
  it("maps @handles to assigned roles", async () => {
    const { addressedRoles, parseTriage } = await import("./overture-role-turn.js");
    expect(addressedRoles("@디자인 시안 부탁, @Security 도", ["conversation-lead", "design-mock-specialist", "security-evaluator"])).toEqual([
      "design-mock-specialist",
      "security-evaluator",
    ]);
    expect(addressedRoles("email me at a@b.com", ["conversation-lead"])).toEqual([]);
    expect(parseTriage('ok {"roles":[{"role":"task-editor","reason":"ready"},{"role":"nope"}]}', ["task-editor"])).toEqual([{ roleId: "task-editor", reason: "ready" }]);
  });
});
