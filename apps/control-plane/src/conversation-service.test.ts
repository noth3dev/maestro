import { describe, expect, it, vi } from "vitest";
import { createPostgresConversationService, modelActivity } from "./conversation-service.js";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import type { OperatorContext } from "@maestro/persistence";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const operator: OperatorContext = {
  operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05",
  credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06",
};

describe("conversation activity mapping", () => {
  it("exposes phases without forwarding reasoning or tool arguments", () => {
    const thinking = modelActivity({ kind: "thinking-delta", cursor: 1 });
    expect(thinking).toEqual({ phase: "thinking" });
    const proposed = modelActivity({
      kind: "tool-proposed",
      cursor: 2,
      call: { id: "call-1", name: "readGoal", arguments: { state: "valid", value: { secret: "do-not-forward" } } },
    });
    expect(proposed).toEqual({ phase: "tool-call", toolName: "readGoal", status: "proposed" });
    expect(JSON.stringify(proposed)).not.toContain("do-not-forward");
    expect(modelActivity({ kind: "usage", cursor: 3, usage: { state: "unknown" } })).toBeUndefined();
  });
});

class FakePool {
  cursor = 0;
  conversation: Record<string, unknown> | undefined;
  events: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  turns: Array<{ turn_id: string; turn_ref: string; request_id: string; role: string; content: string; status: string; cursor: string }> =
    [];
  async query(sql: string, _params: unknown[] = []) {
    if (sql.startsWith("SELECT project_id FROM goals")) return { rowCount: 1, rows: [{ project_id: projectId }] };
    if (sql.startsWith("SELECT conversation_id")) {
      const projectMatches = _params.length < 2 || _params[1] === projectId;
      const ownerMatches =
        sql.includes("operator_id =") === false || _params[sql.includes("operator_id = $1") ? 0 : 2] === operator.operatorId;
      return projectMatches && ownerMatches && this.conversation ? { rowCount: 1, rows: [this.conversation] } : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("SELECT turn_ref")) {
      const found = this.turns.find((turn) => turn.request_id === _params[1] && turn.role === "user");
      return found === undefined
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ turn_ref: found.turn_ref, content: found.content }] };
    }
    if (sql.startsWith("SELECT turn_id, content, status, cursor::text AS cursor")) {
      const found = this.turns.find((turn) => turn.turn_ref === _params[1] && turn.role === "assistant");
      return found === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ ...found, created_at: new Date() }] };
    }
    if (sql.includes("FROM conversations WHERE status IN"))
      return { rowCount: this.conversation ? 1 : 0, rows: this.conversation ? [this.conversation] : [] };
    if (sql.includes("UPDATE conversations")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("INSERT INTO conversation_events")) {
      this.events.push({ event_type: "turn_delta", payload: JSON.parse(String(_params[3])) });
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  }
  async connect() {
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 1, rows: [] };
        if (sql.startsWith("SELECT conversation_id")) {
          const projectMatches = params.length < 2 || params[1] === projectId;
          const ownerMatches =
            sql.includes("operator_id =") === false || params[sql.includes("operator_id = $1") ? 0 : 2] === operator.operatorId;
          return projectMatches && ownerMatches && this.conversation
            ? { rowCount: 1, rows: [this.conversation] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith("SELECT turn_ref")) {
          const found = this.turns.find((turn) => turn.request_id === params[1] && turn.role === "user");
          return found === undefined
            ? { rowCount: 0, rows: [] }
            : { rowCount: 1, rows: [{ turn_ref: found.turn_ref, content: found.content }] };
        }
        if (sql.startsWith("SELECT turn_id, content, status, cursor::text AS cursor")) {
          const found = this.turns.find((turn) => turn.turn_ref === params[1] && turn.role === "assistant");
          return found === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ ...found, created_at: new Date() }] };
        }
        if (sql.startsWith("SELECT cursor::text AS cursor FROM conversation_events")) return { rowCount: 0, rows: [] };
        if (sql.startsWith("INSERT INTO conversations")) {
          this.conversation = {
            conversation_id: params[0],
            operator_id: params[1],
            project_id: params[2],
            goal_id: params[3],
            model_provider: params[4],
            model_id: params[5],
            status: "active",
            version: 1,
            binding: JSON.parse(String(params[6])),
            active_turn_id: null,
            active_request_id: null,
          };
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith("INSERT INTO conversation_events")) {
          this.events.push({ event_type: String(params[3]), payload: JSON.parse(String(params[4])) });
          return { rowCount: 1, rows: [{ cursor: String(++this.cursor) }] };
        }
        if (sql.startsWith("INSERT INTO conversation_turns")) {
          const turn = {
            turn_id: String(params[0]),
            turn_ref: String(params[1]),
            request_id: String(params[2]),
            role: String(sql.includes("'user'") ? "user" : "assistant"),
            content: String(params[5]),
            status: String(params[6]),
            cursor: String(params[7]),
          };
          if (!this.turns.some((existing) => existing.turn_id === turn.turn_id)) this.turns.push(turn);
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith("UPDATE conversations")) {
          if (this.conversation) {
            const running = sql.includes("status = 'running'");
            if (running) {
              if (this.conversation.status === "running") return { rowCount: 0, rows: [] };
              this.conversation.status = "running";
            } else {
              this.conversation.status = params[1];
            }
            this.conversation.version = Number(this.conversation.version) + 1;
          }
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
  }
}

function fakeGateway(): ModelGatewayPort {
  const binding = {
    bindingId: "binding-1",
    gatewayInstanceId: "gateway-1",
    provider: { provider: "openai", id: "gpt-5" },
    account: { providerId: "openai", accountRef: "acct-1", authMode: "api-key" as const },
    dataPolicyHash: "policy",
  };
  return {
    listModels: async () => [
      {
        identity: binding.provider,
        capabilities: new Set(["text"]),
        authModes: ["api-key"],
        dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] },
      },
    ],
    admit: async () => binding,
    turn: async (request) => {
      request.emit({ kind: "text-delta", cursor: 1, text: "hello from model" });
      return {
        requestId: request.requestId,
        model: binding.provider,
        text: "hello from model",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { state: "available", totalTokens: 3 },
      };
    },
    cancel: async () => ({ state: "confirmed" as const }),
    recover: async () => "reconnected" as const,
    close: async () => {},
  };
}

describe("postgres conversation service", () => {
  it("admits an exact model and persists the assistant result without exposing account refs", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    expect(conversation).toMatchObject({ projectId, goalId, model: "openai/gpt-5", status: "active" });
    expect(JSON.stringify(conversation)).not.toContain("acct-1");
    const result = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator);
    expect(result.turn.content).toBe("hello from model");
    expect(result.conversation.status).toBe("succeeded");
    expect(pool.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "turn_delta", payload: expect.objectContaining({ text: "hello from model" }) }),
      ]),
    );
  });
  it("creates and resumes a durable project-scoped conversation without a Goal", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });

    const conversation = await service.create({ projectId, goalId: null, model: "openai/gpt-5" }, operator);
    expect(conversation).toMatchObject({ projectId, goalId: null, model: "openai/gpt-5", status: "active" });
    const result = await service.turn(conversation.conversationId, { projectId, text: "start from the project brief" }, operator);

    expect(result.conversation.goalId).toBeNull();
    expect(result.turn.content).toBe("hello from model");
    expect(pool.turns).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "start from the project brief" })]),
    );
  });

  it("denies a Goal-less conversation read from another project", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId: null, model: "openai/gpt-5" }, operator);

    await expect(service.get(conversation.conversationId, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99", operator)).rejects.toBeInstanceOf(Error);
  });

  it("denies a Goal-less conversation turn from another project", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId: null, model: "openai/gpt-5" }, operator);

    await expect(
      service.turn(conversation.conversationId, { projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99", text: "cross-project" }, operator),
    ).rejects.toBeInstanceOf(Error);
  });

  it("denies Goal-less conversation events from another project", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId: null, model: "openai/gpt-5" }, operator);

    await expect(
      service.listEvents(conversation.conversationId, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99", "0", operator),
    ).rejects.toBeInstanceOf(Error);
  });

  it("denies Goal-less conversation cancellation from another project", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId: null, model: "openai/gpt-5" }, operator);

    await expect(service.cancel(conversation.conversationId, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99", operator)).rejects.toBeInstanceOf(
      Error,
    );
  });

  it("uses the configured gateway peer identity for model admission", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    const originalListModels = gateway.listModels;
    const originalAdmit = gateway.admit;
    gateway.listModels = async (request) => {
      if (request.operatorId !== "gateway-peer") throw new Error("wrong catalog peer");
      return originalListModels(request);
    };
    gateway.admit = async (request) => {
      if (request.operatorId !== "gateway-peer") throw new Error("wrong admission peer");
      return originalAdmit(request);
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-peer",
      accountRefs: { openai: "acct-1" },
    });

    await expect(service.create({ projectId, goalId, model: "openai/gpt-5" }, operator)).resolves.toMatchObject({ model: "openai/gpt-5" });
  });

  it("replays the same conversation for a repeated create idempotency key", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    let admits = 0;
    const originalAdmit = gateway.admit;
    gateway.admit = async (request) => {
      admits += 1;
      return originalAdmit(request);
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const requestId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f10";

    const first = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator, requestId);
    const second = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator, requestId);

    expect(second).toEqual(first);
    expect(admits).toBe(1);
  });

  it("replays a durable create while the gateway is unavailable", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    let available = true;
    const originalListModels = gateway.listModels;
    gateway.listModels = async (request) => {
      if (!available) throw new Error("gateway unavailable");
      return originalListModels(request);
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const requestId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f12";
    const first = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator, requestId);
    available = false;

    await expect(service.create({ projectId, goalId, model: "openai/gpt-5" }, operator, requestId)).resolves.toEqual(first);
  });

  it("replays the same assistant turn for a repeated idempotency key", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    let calls = 0;
    const originalTurn = gateway.turn;
    gateway.turn = async (request) => {
      calls += 1;
      return originalTurn(request);
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const requestId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09";

    const first = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator, requestId);
    const second = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator, requestId);

    expect(second.turn).toMatchObject({
      turnId: first.turn.turnId,
      content: first.turn.content,
      status: first.turn.status,
      cursor: first.turn.cursor,
    });
    expect(calls).toBe(1);
  });

  it("rejects an idempotency key reused with different turn text", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const requestId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f11";
    await service.turn(conversation.conversationId, { projectId, text: "original" }, operator, requestId);

    await expect(service.turn(conversation.conversationId, { projectId, text: "tampered" }, operator, requestId)).rejects.toThrow(
      "idempotency key is bound to different turn text",
    );
  });

  it("rejects NUL and unpaired surrogate turn input before persistence", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    await expect(service.turn(conversation.conversationId, { projectId, text: "bad\u0000text" }, operator)).rejects.toThrow(
      "conversation text",
    );
    await expect(service.turn(conversation.conversationId, { projectId, text: "bad\ud800text" }, operator)).rejects.toThrow(
      "invalid Unicode",
    );
  });

  it("keeps UTF-8 persistence truncation on code-point boundaries", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    const output = "a".repeat(59_997) + "😀";
    gateway.turn = async (request) => ({
      requestId: request.requestId,
      model: { provider: "openai", id: "gpt-5" },
      text: output,
      toolCalls: [],
      stopReason: "end_turn",
      usage: { state: "unknown" },
    });
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    const result = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator);

    expect(Buffer.byteLength(result.turn.content, "utf8")).toBeLessThanOrEqual(60_000);
    expect(result.turn.content).not.toContain("\ufffd");
    expect(result.turn.content.codePointAt(result.turn.content.length - 1)).not.toBe(0xd800);
  });

  it("does not persist provider error details in a turn result", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    gateway.turn = async () => {
      throw new Error("Bearer provider-secret-token");
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    const result = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator);

    expect(result.turn.content).toBe("Model turn outcome is unavailable");
    expect(JSON.stringify(result)).not.toContain("provider-secret-token");
  });

  it("does not expose a conversation to another operator in the same project", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    await expect(
      service.get(conversation.conversationId, projectId, {
        operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07",
        credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f08",
      }),
    ).rejects.toThrow();
  });

  it("persists a cancellation terminal event for the active conversation", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    const cancelled = await service.cancel(conversation.conversationId, projectId, operator);

    expect(cancelled.status).toBe("cancelled");
    expect(pool.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "turn_cancelled", payload: expect.objectContaining({ status: "cancelled" }) }),
      ]),
    );
  });

  it("rebuilds active conversation runtime handles after restart", async () => {
    const pool = new FakePool();
    pool.conversation = {
      conversation_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
      operator_id: operator.operatorId,
      project_id: projectId,
      goal_id: goalId,
      model_provider: "openai",
      model_id: "gpt-5",
      status: "active",
      version: 1,
      active_turn_id: null,
      active_request_id: null,
      binding: {
        bindingId: "binding-1",
        gatewayInstanceId: "gateway-1",
        provider: { provider: "openai", id: "gpt-5" },
        account: { providerId: "openai", accountRef: "acct-1", authMode: "api-key" },
        dataPolicyHash: "policy",
      },
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway: fakeGateway(),
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
    });
    await expect(service.recover?.()).resolves.toEqual({ recovered: 1, markedUnknown: 0 });
    await expect(service.turn("018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", { projectId, text: "hi" }, operator)).resolves.toMatchObject({
      turn: { content: "hello from model" },
    });
  });
});

describe("goal-less Overture drafting boundary", () => {
  const draft = {
    desiredOutcome: "Ship the intake feature",
    userVisibleBehavior: ["The operator can submit a brief"],
    successCriteria: ["A durable Task Contract exists"],
    liveEvidence: ["A persisted row"],
    scope: ["Project-scoped intake"],
    nonGoals: ["Launching workers"],
    priorities: ["Safety"],
    acceptableTradeoffs: ["Ask clarifying questions"],
    constraints: ["No execution effects"],
    knownEdgeCases: ["Vague brief"],
    project: { projectId, repository: "/repo", immutableBaseRevision: "abc123", dataBoundary: "repository files only" },
    evidenceReferences: ["brief"],
    approvedPreviewReferences: [],
    expectedGroups: ["Product Group"],
    expectedDepartments: ["Product Department"],
    criticalActionExpectations: ["Human confirmation"],
    forbiddenEffects: ["Worker spawn", "Mission Bundle"],
    environmentAssumptions: ["PostgreSQL"],
    externalServiceAssumptions: ["None"],
    budget: { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["Stop at ceiling"] },
  };
  function contract(contractId: string) {
    return {
      contractId,
      schemaVersion: 1 as const,
      version: 1,
      ...draft,
      decisionHistory: [],
      contentHash: "a".repeat(64),
      launchState: "awaiting_confirmation" as const,
    };
  }

  it("offers only task-contract:create to goal-less runtime and creates through the durable service", async () => {
    const pool = new FakePool();
    const createTaskContract = vi.fn(async (contractId: string) => contract(contractId));
    const requests: Array<{ tools: readonly { name: string }[]; childCalls: number }> = [];
    const gateway = fakeGateway();
    gateway.turn = async (request) => {
      requests.push({ tools: request.tools, childCalls: request.limits.maxChildCalls });
      if (requests.length === 1)
        return {
          requestId: request.requestId,
          model: { provider: "openai", id: "gpt-5" },
          text: "",
          toolCalls: [
            { id: "create-1", name: "task-contract:create", arguments: { state: "valid", value: { projectId, substance: draft } } },
          ],
          stopReason: "tool_use",
          usage: { state: "available", totalTokens: 3 },
        };
      return {
        requestId: request.requestId,
        model: { provider: "openai", id: "gpt-5" },
        text: "Draft created",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { state: "available", totalTokens: 3 },
      };
    };
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
      taskContractService: { createTaskContract } as never,
    });
    const conversation = await service.create({ projectId, goalId: null, model: "openai/gpt-5" }, operator);
    const result = await service.turn(conversation.conversationId, { projectId, text: "Ship the intake feature" }, operator);
    expect(JSON.parse(result.turn.content)).toMatchObject({
      contractId: expect.any(String),
      desiredOutcome: draft.desiredOutcome,
      launchState: "awaiting_confirmation",
    });
    expect(createTaskContract).toHaveBeenCalledOnce();
    expect(requests[0]).toMatchObject({ tools: [{ name: "task-contract:create" }], childCalls: 0 });
    expect(requests[0]!.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringMatching(/worker|mission|ipython/i) })]),
    );
  });

  it("keeps the existing Goal-bound grant empty even when the model proposes the drafting tool", async () => {
    const pool = new FakePool();
    const createTaskContract = vi.fn();
    const gateway = fakeGateway();
    gateway.turn = async (request) => ({
      requestId: request.requestId,
      model: { provider: "openai", id: "gpt-5" },
      text: "",
      toolCalls: [{ id: "create-1", name: "task-contract:create", arguments: { state: "valid", value: { projectId, substance: draft } } }],
      stopReason: "tool_use",
      usage: { state: "available", totalTokens: 3 },
    });
    const service = createPostgresConversationService({
      pool: pool as never,
      gateway,
      gatewayOperatorId: "gateway-operator",
      accountRefs: { openai: "acct-1" },
      taskContractService: { createTaskContract } as never,
    });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const result = await service.turn(conversation.conversationId, { projectId, text: "Do not use intake" }, operator);
    expect(result.turn.status).toBe("failed");
    expect(createTaskContract).not.toHaveBeenCalled();
  });
});
