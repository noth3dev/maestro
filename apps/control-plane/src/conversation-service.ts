import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { OperatorContext } from "@maestro/persistence";
import { UuidSchema, type Conversation, type ConversationEvent, type ConversationTurnInput, type ConversationTurnResult, type CreateConversationInput, type ModelCatalogEntry } from "@maestro/contracts";
import { createMaestroAgentRuntime, ToolRegistry, parseModelRef, formatModelRef, type ModelGatewayPort, type GatewayBinding } from "@maestro/agent-runtime";

export class ConversationNotFoundError extends Error {}
export class ConversationConflictError extends Error {}
export class ConversationUnavailableError extends Error {}
export class ConversationModelNotAllowedError extends Error {}

export interface ConversationService {
  listModels(operator: OperatorContext): Promise<readonly ModelCatalogEntry[]>;
  create(input: CreateConversationInput, operator: OperatorContext): Promise<Conversation>;
  get(conversationId: string, projectId: string, operator: OperatorContext): Promise<Conversation>;
  turn(conversationId: string, input: ConversationTurnInput, operator: OperatorContext): Promise<ConversationTurnResult>;
  cancel(conversationId: string, projectId: string, operator: OperatorContext): Promise<Conversation>;
  listEvents(conversationId: string, projectId: string, after: string, operator: OperatorContext): Promise<readonly ConversationEvent[]>;
  close?(): Promise<void>;
}

type RuntimeHandle = { execution: import("@maestro/domain").ExecutionRef; invocation: import("@maestro/domain").InvocationRef; runtime: ReturnType<typeof createMaestroAgentRuntime>; binding: GatewayBinding };
type ConversationRow = { conversation_id: string; project_id: string; goal_id: string; model_provider: string; model_id: string; status: Conversation["status"]; version: number };

const MAX_TEXT = 64_000;
const SECRET_LIKE = /(bearer\s+[\w./+=-]{12,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)\s*[:=]|-----begin .*private key-----|(?:^|[^a-z0-9])sk-[a-z0-9_-]{16,})/i;
function assertSafeText(text: string): void {
  if (text.length > MAX_TEXT || SECRET_LIKE.test(text)) throw new ConversationConflictError("conversation text is invalid or contains credential-like data");
}
function modelFromRow(row: ConversationRow): Conversation {
  return { conversationId: UuidSchema.parse(row.conversation_id), projectId: UuidSchema.parse(row.project_id), goalId: UuidSchema.parse(row.goal_id), model: formatModelRef({ provider: row.model_provider, id: row.model_id }), status: row.status, version: row.version };
}
function statusFromObservation(status: string): Conversation["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "unknown") return "unknown";
  return "running";
}
function now(): string { return new Date().toISOString(); }

export function createPostgresConversationService(options: {
  pool: Pool;
  gateway: ModelGatewayPort;
  gatewayOperatorId: string;
  accountRefs: Readonly<Record<string, string>>;
  dataPolicyHash?: string;
  tools?: ToolRegistry;
}): ConversationService {
  const runtimes = new Map<string, RuntimeHandle>();
  const tools = options.tools ?? new ToolRegistry();
  const policyHash = options.dataPolicyHash ?? "maestro-local-v1";

  async function read(conversationId: string, projectId: string): Promise<ConversationRow> {
    const result = await options.pool.query<ConversationRow>("SELECT conversation_id, project_id, goal_id, model_provider, model_id, status, version FROM conversations WHERE conversation_id = $1 AND project_id = $2", [conversationId, projectId]);
    if (result.rowCount !== 1) throw new ConversationNotFoundError();
    return result.rows[0]!;
  }
  async function addEvent(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ cursor: string }> }> }, conversationId: string, projectId: string, eventType: ConversationEvent["eventType"], payload: Record<string, unknown>): Promise<string> {
    const result = await client.query("INSERT INTO conversation_events (event_id, conversation_id, project_id, event_type, payload) VALUES ($1, $2, $3, $4, $5) RETURNING cursor::text", [randomUUID(), conversationId, projectId, eventType, JSON.stringify(payload)]);
    return result.rows[0]!.cursor;
  }

  return {
    async listModels(_operator: OperatorContext) {
      const models = await options.gateway.listModels({ operatorId: options.gatewayOperatorId });
      return models.map((model) => ({ ...model, capabilities: [...model.capabilities], authModes: [...model.authModes], dataPolicy: { ...model.dataPolicy, allowedDataClasses: [...model.dataPolicy.allowedDataClasses], regions: [...model.dataPolicy.regions] } }));
    },
    async create(input, operator) {
      const goal = await options.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [input.goalId]);
      if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId) throw new ConversationConflictError("conversation Goal/project binding is invalid");
      const parsed = parseModelRef(input.model);
      const models = await options.gateway.listModels({ operatorId: options.gatewayOperatorId });
      const catalog = models.find((item) => item.identity.provider === parsed.provider && item.identity.id === parsed.id);
      if (catalog === undefined || !catalog.capabilities.has("text")) throw new ConversationModelNotAllowedError();
      const accountRef = options.accountRefs[parsed.provider];
      if (accountRef === undefined) throw new ConversationUnavailableError("no provider account is configured");
      const conversationId = randomUUID();
      const binding = await options.gateway.admit({ requestId: `admit-${conversationId}`, operatorId: options.gatewayOperatorId, providerId: parsed.provider, model: parsed, accountRef, dataPolicyHash: policyHash });
      const runtime = createMaestroAgentRuntime({ gateway: options.gateway, binding, tools });
      const grant = { grantId: `grant-${conversationId}`, allowedTools: [], allowedSkills: [], modelPolicy: [input.model], pathScope: [], outboundDataClasses: ["public", "workspace"], remaining: { modelTurns: 8, toolCalls: 0, childCalls: 0, outputTokens: 8_192, wallTimeMs: 120_000, retryCount: 0 } };
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, $2, $3, $4, $5, $6, 'active', 1, $7)", [conversationId, operator.operatorId, input.projectId, input.goalId, parsed.provider, parsed.id, JSON.stringify(binding)]);
        await addEvent(client, conversationId, input.projectId, "conversation_created", { model: input.model });
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); await runtime.close?.(); throw error; } finally { client.release(); }
      let spawned: Awaited<ReturnType<typeof runtime.spawn>>;
      try {
        spawned = await runtime.spawn({ name: `conversation-${conversationId}`, context: { operatorId: operator.operatorId, projectId: input.projectId, goalId: input.goalId, missionBundleId: "conversation", policyVersion: "1", accountRef }, grant, modelPolicy: [input.model], idempotencyKey: conversationId });
      } catch {
        await options.pool.query("UPDATE conversations SET status = 'unknown', version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1", [conversationId]);
        await runtime.close?.();
        throw new ConversationUnavailableError("conversation runtime admission failed");
      }
      runtimes.set(conversationId, { execution: spawned.execution, invocation: spawned.invocation, runtime, binding });
      return { conversationId, projectId: input.projectId, goalId: input.goalId, model: input.model, status: "active", version: 1 };
    },
    async get(conversationId, projectId) { return modelFromRow(await read(conversationId, projectId)); },
    async turn(conversationId, input, _operator) {
      assertSafeText(input.text);
      const row = await read(conversationId, input.projectId);
      if (row.status === "unknown" || row.status === "cancelled") throw new ConversationUnavailableError("conversation is not resumable");
      const handle = runtimes.get(conversationId);
      if (handle === undefined) throw new ConversationUnavailableError("conversation runtime is unavailable after restart");
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query("UPDATE conversations SET status = 'running', version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND version = $2 AND status NOT IN ('running', 'cancelled', 'unknown')", [conversationId, row.version]);
        if (claimed.rowCount !== 1) throw new ConversationConflictError("conversation already has an active turn");
        await client.query("INSERT INTO conversation_turns (turn_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, 'user', $4, 'accepted', 0)", [randomUUID(), conversationId, input.projectId, input.text]);
        await addEvent(client, conversationId, input.projectId, "turn_started", {});
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); client.release(); throw error; }
      client.release();
      let observed: Awaited<ReturnType<typeof handle.runtime.observe>>[number] | undefined;
      try {
        await handle.runtime.prompt(handle.execution, input.text);
        observed = (await handle.runtime.observe(handle.execution)).find((item) => item.invocation === handle.invocation);
      } catch { observed = undefined; }
      const status = statusFromObservation(observed?.status ?? "unknown");
      const content = observed?.answer.state === "available" ? observed.answer.text : observed?.error ?? "Model turn outcome is unavailable";
      const turnId = randomUUID();
      const resultClient = await options.pool.connect();
      let completedCursor: string;
      try {
        await resultClient.query("BEGIN");
        completedCursor = await addEvent(resultClient, conversationId, input.projectId, status === "succeeded" ? "turn_completed" : status === "cancelled" ? "turn_cancelled" : status === "unknown" ? "turn_unknown" : "turn_failed", { status });
        await resultClient.query("INSERT INTO conversation_turns (turn_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, 'assistant', $4, $5, $6)", [turnId, conversationId, input.projectId, content.slice(0, MAX_TEXT), status === "succeeded" ? "completed" : status, completedCursor]);
        await resultClient.query("UPDATE conversations SET status = $2, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1", [conversationId, status]);
        await resultClient.query("COMMIT");
      } catch (error) { await resultClient.query("ROLLBACK"); resultClient.release(); throw error; }
      resultClient.release();
      const turnStatus = status === "succeeded" ? "completed" as const : status === "failed" ? "failed" as const : status === "cancelled" ? "cancelled" as const : "unknown" as const;
      return { conversation: { ...modelFromRow(row), status, version: row.version + 2 }, turn: { turnId, conversationId, role: "assistant" as const, content: content.slice(0, MAX_TEXT), status: turnStatus, cursor: completedCursor!, createdAt: now() } };
    },
    async cancel(conversationId, projectId) {
      const row = await read(conversationId, projectId);
      const handle = runtimes.get(conversationId);
      if (handle !== undefined) await handle.runtime.cancel(handle.invocation);
      const next: Conversation["status"] = handle === undefined ? "unknown" : await handle.runtime.getInvocationStatus(handle.invocation) === "cancelled" ? "cancelled" : "unknown";
      await options.pool.query("UPDATE conversations SET status = $2, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1", [conversationId, next]);
      return { ...modelFromRow(row), status: next, version: row.version + 1 };
    },
    async listEvents(conversationId, projectId, after) {
      await read(conversationId, projectId);
      const result = await options.pool.query<{ cursor: string; event_id: string; conversation_id: string; project_id: string; event_type: ConversationEvent["eventType"]; payload: Record<string, unknown>; occurred_at: string }>("SELECT cursor::text AS cursor, event_id, conversation_id, project_id, event_type, payload, occurred_at FROM conversation_events WHERE conversation_id = $1 AND project_id = $2 AND cursor > $3::bigint ORDER BY cursor ASC LIMIT 256", [conversationId, projectId, after]);
      return result.rows.map((row) => ({ cursor: row.cursor, eventId: row.event_id, conversationId: row.conversation_id, projectId: row.project_id, eventType: row.event_type, payload: row.payload, occurredAt: new Date(row.occurred_at).toISOString() }));
    },
    async close() { await Promise.all([...runtimes.values()].map(async (handle) => { await handle.runtime.close?.(); })); runtimes.clear(); },
  };
}
