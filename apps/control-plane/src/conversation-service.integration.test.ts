import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import type { OperatorContext } from "@maestro/persistence";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { createPostgresConversationService } from "./conversation-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const operator: OperatorContext = { operatorId: `conversation-integration-${randomUUID()}`, credentialId: `credential-${randomUUID()}` };

function gatewayFixture(options: { block?: boolean } = {}): { gateway: ModelGatewayPort; calls: () => number; started: Promise<void>; release: () => void } {
  const binding = { bindingId: "integration-binding", gatewayInstanceId: "integration-gateway", provider: { provider: "openai", id: "gpt-5" }, account: { providerId: "openai", accountRef: "integration-account", authMode: "api-key" as const }, dataPolicyHash: "integration-policy" };
  let calls = 0;
  let lastMessages: string[] = [];
  let startResolve!: () => void;
  const started = new Promise<void>((resolve) => { startResolve = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  return {
    calls: () => calls,
    messages: () => lastMessages,
    started,
    release,
    gateway: {
      listModels: async () => [{ identity: binding.provider, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] } }],
      admit: async () => binding,
      turn: async (request) => {
        calls += 1;
        lastMessages = request.messages.map((message) => message.role);
        startResolve();
        if (options.block) {
          await released;
          if (request.signal.aborted) throw new Error("provider request cancelled");
        }
        request.emit({ kind: "text-delta", cursor: 1, text: "integration answer" });
        return { requestId: request.requestId, model: binding.provider, text: "integration answer", toolCalls: [], stopReason: "end_turn", usage: { state: "available", totalTokens: 3 } };
      },
      cancel: async () => ({ state: "confirmed" as const }),
      recover: async () => "reconnected" as const,
      close: async () => {},
    },
  };
}

describeDatabase("conversation service PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const projectId = randomUUID();
  const goalId = randomUUID();

  beforeAll(async () => {
    await applyAllMigrations(pool);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM goals WHERE goal_id = $1", [goalId]);
    await pool.end();
  });

  it("persists bounded turn identity, terminal state, and idempotent replay", async () => {
    const fixture = gatewayFixture();
    const service = createPostgresConversationService({ pool, gateway: fixture.gateway, gatewayOperatorId: "integration-gateway", accountRefs: { openai: "integration-account" } });
    const createRequestId = randomUUID();
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator, createRequestId);
    const replayedConversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator, createRequestId);
    const requestId = randomUUID();

    const first = await service.turn(conversation.conversationId, { projectId, text: "hello" }, operator, requestId);
    const second = await service.turn(conversation.conversationId, { projectId, text: "hello" }, operator, requestId);
    const rows = await pool.query<{ role: string; turn_ref: string; request_id: string; status: string }>("SELECT role, turn_ref, request_id, status FROM conversation_turns WHERE conversation_id = $1 ORDER BY created_at", [conversation.conversationId]);
    const events = await pool.query<{ event_type: string; payload: Record<string, unknown> }>("SELECT event_type, payload FROM conversation_events WHERE conversation_id = $1 ORDER BY cursor", [conversation.conversationId]);
    const storedConversation = await pool.query<{ status: string; active_turn_id: string | null; active_request_id: string | null }>("SELECT status, active_turn_id, active_request_id FROM conversations WHERE conversation_id = $1", [conversation.conversationId]);

    expect(replayedConversation).toEqual(conversation);
    expect(first.turn.content).toBe("integration answer");
    expect(second.turn).toMatchObject({ turnId: first.turn.turnId, content: first.turn.content, cursor: first.turn.cursor });
    expect(fixture.calls()).toBe(1);
    expect(rows.rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows.rows[0]).toMatchObject({ turn_ref: rows.rows[1]!.turn_ref, request_id: requestId });
    expect(storedConversation.rows[0]).toEqual({ status: "succeeded", active_turn_id: null, active_request_id: null });
    expect(events.rows.map((event) => event.event_type)).toEqual(["conversation_created", "turn_started", "turn_delta", "turn_completed"]);
    expect(JSON.stringify(events.rows)).not.toContain("integration-account");
  });

  it("restores durable user and assistant context after runtime restart", async () => {
    const fixture = gatewayFixture();
    const service = createPostgresConversationService({ pool, gateway: fixture.gateway, gatewayOperatorId: "integration-gateway", accountRefs: { openai: "integration-account" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const priorTurnRef = randomUUID();
    await pool.query("INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'user', 'prior question', 'accepted', 0), ($6, $2, $7, $4, $5, 'assistant', 'prior answer', 'completed', 0)", [randomUUID(), priorTurnRef, randomUUID(), conversation.conversationId, projectId, randomUUID(), randomUUID()]);
    const restarted = createPostgresConversationService({ pool, gateway: fixture.gateway, gatewayOperatorId: "integration-gateway", accountRefs: { openai: "integration-account" } });

    await expect(restarted.recover?.()).resolves.toMatchObject({ recovered: 1, markedUnknown: 0 });
    await expect(restarted.turn(conversation.conversationId, { projectId, text: "follow up" }, operator, randomUUID())).resolves.toMatchObject({ turn: { content: "integration answer" } });

    expect(fixture.messages()).toEqual(["user", "assistant", "user"]);
  });

  it("serializes concurrent retries for one idempotency key", async () => {
    const fixture = gatewayFixture({ block: true });
    const service = createPostgresConversationService({ pool, gateway: fixture.gateway, gatewayOperatorId: "integration-gateway", accountRefs: { openai: "integration-account" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const requestId = randomUUID();
    const firstPromise = service.turn(conversation.conversationId, { projectId, text: "first" }, operator, requestId);
    await fixture.started;
    const secondPromise = service.turn(conversation.conversationId, { projectId, text: "first" }, operator, requestId);
    await expect(secondPromise).rejects.toThrow("conversation turn is already in progress");
    fixture.release();
    await expect(firstPromise).resolves.toMatchObject({ turn: { content: "integration answer" } });
    expect(fixture.calls()).toBe(1);
  });

  it("marks an interrupted active turn unknown during restart recovery", async () => {
    const fixture = gatewayFixture();
    const service = createPostgresConversationService({ pool, gateway: fixture.gateway, gatewayOperatorId: "integration-gateway", accountRefs: { openai: "integration-account" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const turnId = randomUUID();
    const requestId = randomUUID();
    await pool.query("UPDATE conversations SET status = 'running', active_turn_id = $2, active_request_id = $3, version = version + 1 WHERE conversation_id = $1", [conversation.conversationId, turnId, requestId]);
    await pool.query("INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'user', 'interrupted', 'accepted', 0)", [randomUUID(), turnId, requestId, conversation.conversationId, projectId]);

    await expect(service.recover?.()).resolves.toMatchObject({ recovered: 0, markedUnknown: 1 });
    const state = await service.get(conversation.conversationId, projectId, operator);
    const events = await pool.query<{ event_type: string; payload: Record<string, unknown> }>("SELECT event_type, payload FROM conversation_events WHERE conversation_id = $1 AND event_type = 'turn_unknown'", [conversation.conversationId]);
    const assistant = await pool.query<{ turn_id: string; status: string }>("SELECT turn_id, status FROM conversation_turns WHERE conversation_id = $1 AND role = 'assistant'", [conversation.conversationId]);

    expect(state.status).toBe("unknown");
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.payload).toMatchObject({ turnId, status: "unknown" });
    expect(assistant.rows).toEqual([{ turn_id: turnId, status: "unknown" }]);
  });

  it("fences cancellation and records one terminal assistant row", async () => {
    const fixture = gatewayFixture({ block: true });
    const service = createPostgresConversationService({ pool, gateway: fixture.gateway, gatewayOperatorId: "integration-gateway", accountRefs: { openai: "integration-account" } });
    const conversation = await service.create({ projectId, goalId, model: "openai/gpt-5" }, operator);
    const turnPromise = service.turn(conversation.conversationId, { projectId, text: "cancel me" }, operator, randomUUID());
    await fixture.started;

    const cancelled = await service.cancel(conversation.conversationId, projectId, operator);
    fixture.release();
    const completed = await turnPromise;
    const events = await pool.query<{ event_type: string }>("SELECT event_type FROM conversation_events WHERE conversation_id = $1 AND event_type LIKE 'turn_%' ORDER BY cursor", [conversation.conversationId]);
    const assistants = await pool.query<{ turn_id: string; status: string }>("SELECT turn_id, status FROM conversation_turns WHERE conversation_id = $1 AND role = 'assistant'", [conversation.conversationId]);
    const storedConversation = await pool.query<{ status: string; active_turn_id: string | null; active_request_id: string | null }>("SELECT status, active_turn_id, active_request_id FROM conversations WHERE conversation_id = $1", [conversation.conversationId]);

    expect(cancelled.status).toBe("cancelled");
    expect(completed.turn.status).toBe("cancelled");
    expect(events.rows.map((event) => event.event_type)).toEqual(["turn_started", "turn_cancelled"]);
    expect(assistants.rows).toHaveLength(1);
    expect(assistants.rows[0]!.status).toBe("cancelled");
    expect(storedConversation.rows[0]).toEqual({ status: "cancelled", active_turn_id: null, active_request_id: null });
  });
});
