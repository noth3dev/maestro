import { describe, expect, it } from "vitest";
import { createPostgresConversationService } from "./conversation-service.js";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import type { OperatorContext } from "@maestro/persistence";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const operator: OperatorContext = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };

class FakePool {
  cursor = 0;
  conversation: Record<string, unknown> | undefined;
  events: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  turns: Array<{ turn_id: string; turn_ref: string; request_id: string; role: string; content: string; status: string; cursor: string }> = [];
  async query(sql: string, _params: unknown[] = []) {
    if (sql.startsWith("SELECT project_id FROM goals")) return { rowCount: 1, rows: [{ project_id: projectId }] };
    if (sql.startsWith("SELECT conversation_id")) {
      const ownerMatches = _params.length < 3 || _params[2] === operator.operatorId;
      return ownerMatches && this.conversation ? { rowCount: 1, rows: [this.conversation] } : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("SELECT turn_ref")) {
      const found = this.turns.find((turn) => turn.request_id === _params[1] && turn.role === "user");
      return found === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ turn_ref: found.turn_ref, content: found.content }] };
    }
    if (sql.startsWith("SELECT turn_id, content, status, cursor::text AS cursor")) {
      const found = this.turns.find((turn) => turn.turn_ref === _params[1] && turn.role === "assistant");
      return found === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ ...found, created_at: new Date() }] };
    }
    if (sql.includes("FROM conversations WHERE status IN")) return { rowCount: this.conversation ? 1 : 0, rows: this.conversation ? [this.conversation] : [] };
    if (sql.includes("UPDATE conversations")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("INSERT INTO conversation_events")) { this.events.push({ event_type: "turn_delta", payload: JSON.parse(String(_params[3])) }); return { rowCount: 1, rows: [] }; }
    return { rowCount: 1, rows: [] };
  }
  async connect() {
    return { query: async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 1, rows: [] };
      if (sql.startsWith("SELECT conversation_id")) return { rowCount: this.conversation ? 1 : 0, rows: this.conversation ? [this.conversation] : [] };
      if (sql.startsWith("SELECT turn_ref")) { const found = this.turns.find((turn) => turn.request_id === params[1] && turn.role === "user"); return found === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ turn_ref: found.turn_ref, content: found.content }] }; }
      if (sql.startsWith("SELECT turn_id, content, status, cursor::text AS cursor")) { const found = this.turns.find((turn) => turn.turn_ref === params[1] && turn.role === "assistant"); return found === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ ...found, created_at: new Date() }] }; }
      if (sql.startsWith("SELECT cursor::text AS cursor FROM conversation_events")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("INSERT INTO conversations")) {
        this.conversation = { conversation_id: params[0], operator_id: params[1], project_id: params[2], goal_id: params[3], model_provider: params[4], model_id: params[5], status: "active", version: 1, binding: JSON.parse(String(params[6])), active_turn_id: null, active_request_id: null };
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("INSERT INTO conversation_events")) { this.events.push({ event_type: String(params[3]), payload: JSON.parse(String(params[4])) }); return { rowCount: 1, rows: [{ cursor: String(++this.cursor) }] }; }
      if (sql.startsWith("INSERT INTO conversation_turns")) {
        const turn = { turn_id: String(params[0]), turn_ref: String(params[1]), request_id: String(params[2]), role: String(sql.includes("'user'") ? "user" : "assistant"), content: String(params[5]), status: String(params[6]), cursor: String(params[7]) };
        if (!this.turns.some((existing) => existing.turn_id === turn.turn_id)) this.turns.push(turn);
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("UPDATE conversations")) { if (this.conversation) { const running = sql.includes("status = 'running'"); if (running) { if (this.conversation.status === "running") return { rowCount: 0, rows: [] }; this.conversation.status = "running"; } else { this.conversation.status = params[1]; } this.conversation.version = Number(this.conversation.version) + 1; } return { rowCount: 1, rows: [] }; }
      return { rowCount: 1, rows: [] };
    }, release() {} };
  }
}

function fakeGateway(): ModelGatewayPort {
  const binding = { bindingId: "binding-1", gatewayInstanceId: "gateway-1", provider: { provider: "openai", id: "gpt-5" }, account: { providerId: "openai", accountRef: "acct-1", authMode: "api-key" as const }, dataPolicyHash: "policy" };
  return {
    listModels: async () => [{ identity: binding.provider, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] } }],
    admit: async () => binding,
    turn: async (request) => { request.emit({ kind: "text-delta", cursor: 1, text: "hello from model" }); return { requestId: request.requestId, model: binding.provider, text: "hello from model", toolCalls: [], stopReason: "end_turn", usage: { state: "available", totalTokens: 3 } }; },
    cancel: async () => ({ state: "confirmed" as const }),
    recover: async () => "reconnected" as const,
    close: async () => {},
  };
}

describe("postgres conversation service", () => {
  it("admits an exact model and persists the assistant result without exposing account refs", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({ pool: pool as never, gateway: fakeGateway(), gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    expect(conversation).toMatchObject({ projectId, goalId, model: "openai/gpt-5", status: "active" });
    expect(JSON.stringify(conversation)).not.toContain("acct-1");
    const result = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator);
    expect(result.turn.content).toBe("hello from model");
    expect(result.conversation.status).toBe("succeeded");
    expect(pool.events).toEqual(expect.arrayContaining([expect.objectContaining({ event_type: "turn_delta", payload: expect.objectContaining({ text: "hello from model" }) })]));
  });
  it("uses the configured gateway peer identity for model admission", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    const originalListModels = gateway.listModels;
    const originalAdmit = gateway.admit;
    gateway.listModels = async (request) => { if (request.operatorId !== "gateway-peer") throw new Error("wrong catalog peer"); return originalListModels(request); };
    gateway.admit = async (request) => { if (request.operatorId !== "gateway-peer") throw new Error("wrong admission peer"); return originalAdmit(request); };
    const service = createPostgresConversationService({ pool: pool as never, gateway, gatewayOperatorId: "gateway-peer", accountRefs: { openai: "acct-1" } });

    await expect(service.create({ projectId, goalId, model: "openai/gpt-5" }, operator)).resolves.toMatchObject({ model: "openai/gpt-5" });
  });

  it("replays the same conversation for a repeated create idempotency key", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    let admits = 0;
    const originalAdmit = gateway.admit;
    gateway.admit = async (request) => { admits += 1; return originalAdmit(request); };
    const service = createPostgresConversationService({ pool: pool as never, gateway, gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
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
    gateway.listModels = async (request) => { if (!available) throw new Error("gateway unavailable"); return originalListModels(request); };
    const service = createPostgresConversationService({ pool: pool as never, gateway, gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
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
    gateway.turn = async (request) => { calls += 1; return originalTurn(request); };
    const service = createPostgresConversationService({ pool: pool as never, gateway, gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const requestId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09";

    const first = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator, requestId);
    const second = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator, requestId);

    expect(second.turn).toMatchObject({ turnId: first.turn.turnId, content: first.turn.content, status: first.turn.status, cursor: first.turn.cursor });
    expect(calls).toBe(1);
  });

  it("rejects an idempotency key reused with different turn text", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({ pool: pool as never, gateway: fakeGateway(), gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const requestId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f11";
    await service.turn(conversation.conversationId, { projectId, text: "original" }, operator, requestId);

    await expect(service.turn(conversation.conversationId, { projectId, text: "tampered" }, operator, requestId)).rejects.toThrow("idempotency key is bound to different turn text");
  });

  it("rejects NUL and unpaired surrogate turn input before persistence", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({ pool: pool as never, gateway: fakeGateway(), gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    await expect(service.turn(conversation.conversationId, { projectId, text: "bad\u0000text" }, operator)).rejects.toThrow("conversation text");
    await expect(service.turn(conversation.conversationId, { projectId, text: "bad\ud800text" }, operator)).rejects.toThrow("invalid Unicode");
  });

  it("keeps UTF-8 persistence truncation on code-point boundaries", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    const output = "a".repeat(59_997) + "😀";
    gateway.turn = async (request) => ({ requestId: request.requestId, model: { provider: "openai", id: "gpt-5" }, text: output, toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } });
    const service = createPostgresConversationService({ pool: pool as never, gateway, gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    const result = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator);

    expect(Buffer.byteLength(result.turn.content, "utf8")).toBeLessThanOrEqual(60_000);
    expect(result.turn.content).not.toContain("\ufffd");
    expect(result.turn.content.codePointAt(result.turn.content.length - 1)).not.toBe(0xd800);
  });

  it("does not persist provider error details in a turn result", async () => {
    const pool = new FakePool();
    const gateway = fakeGateway();
    gateway.turn = async () => { throw new Error("Bearer provider-secret-token"); };
    const service = createPostgresConversationService({ pool: pool as never, gateway, gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    const result = await service.turn(conversation.conversationId, { projectId, text: "hi" }, operator);

    expect(result.turn.content).toBe("Model turn outcome is unavailable");
    expect(JSON.stringify(result)).not.toContain("provider-secret-token");
  });

  it("does not expose a conversation to another operator in the same project", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({ pool: pool as never, gateway: fakeGateway(), gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    await expect(service.get(conversation.conversationId, projectId, { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f08" })).rejects.toThrow();
  });

  it("persists a cancellation terminal event for the active conversation", async () => {
    const pool = new FakePool();
    const service = createPostgresConversationService({ pool: pool as never, gateway: fakeGateway(), gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);

    const cancelled = await service.cancel(conversation.conversationId, projectId, operator);

    expect(cancelled.status).toBe("cancelled");
    expect(pool.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "turn_cancelled", payload: expect.objectContaining({ status: "cancelled" }) }),
    ]));
  });

  it("rebuilds active conversation runtime handles after restart", async () => {
    const pool = new FakePool();
    pool.conversation = { conversation_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", operator_id: operator.operatorId, project_id: projectId, goal_id: goalId, model_provider: "openai", model_id: "gpt-5", status: "active", version: 1, active_turn_id: null, active_request_id: null, binding: { bindingId: "binding-1", gatewayInstanceId: "gateway-1", provider: { provider: "openai", id: "gpt-5" }, account: { providerId: "openai", accountRef: "acct-1", authMode: "api-key" }, dataPolicyHash: "policy" } };
    const service = createPostgresConversationService({ pool: pool as never, gateway: fakeGateway(), gatewayOperatorId: "gateway-operator", accountRefs: { openai: "acct-1" } });
    await expect(service.recover?.()).resolves.toEqual({ recovered: 1, markedUnknown: 0 });
    await expect(service.turn("018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", { projectId, text: "hi" }, operator)).resolves.toMatchObject({ turn: { content: "hello from model" } });
  });

});
