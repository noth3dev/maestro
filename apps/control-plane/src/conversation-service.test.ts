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
  async query(sql: string, _params: unknown[] = []) {
    if (sql.startsWith("SELECT project_id FROM goals")) return { rowCount: 1, rows: [{ project_id: projectId }] };
    if (sql.startsWith("SELECT conversation_id")) return { rowCount: this.conversation ? 1 : 0, rows: this.conversation ? [this.conversation] : [] };
    if (sql.includes("UPDATE conversations")) return { rowCount: 1, rows: [] };
    return { rowCount: 1, rows: [] };
  }
  async connect() {
    return { query: async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 1, rows: [] };
      if (sql.startsWith("INSERT INTO conversations")) {
        this.conversation = { conversation_id: params[0], project_id: params[2], goal_id: params[3], model_provider: params[4], model_id: params[5], status: "active", version: 1 };
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("INSERT INTO conversation_events")) return { rowCount: 1, rows: [{ cursor: String(++this.cursor) }] };
      if (sql.startsWith("UPDATE conversations")) { if (this.conversation) { this.conversation.status = params[1]; this.conversation.version = Number(this.conversation.version) + 1; } return { rowCount: 1, rows: [] }; }
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
  });
});
