import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { OperatorContext } from "@maestro/persistence";
import { UuidSchema, type Conversation, type ConversationEvent, type ConversationTurnInput, type ConversationTurnResult, type CreateConversationInput, type ModelCatalogEntry } from "@maestro/contracts";
import { createMaestroAgentRuntime, ToolRegistry, parseModelRef, formatModelRef, type ModelGatewayPort, type GatewayBinding, type ModelMessage } from "@maestro/agent-runtime";

export class ConversationNotFoundError extends Error {}
export class ConversationConflictError extends Error {}
export class ConversationUnavailableError extends Error {}
export class ConversationModelNotAllowedError extends Error {}

export interface ConversationService {
  listModels(operator: OperatorContext): Promise<readonly ModelCatalogEntry[]>;
  create(input: CreateConversationInput, operator: OperatorContext, requestId?: string): Promise<Conversation>;
  get(conversationId: string, projectId: string, operator: OperatorContext): Promise<Conversation>;
  turn(conversationId: string, input: ConversationTurnInput, operator: OperatorContext, requestId?: string): Promise<ConversationTurnResult>;
  cancel(conversationId: string, projectId: string, operator: OperatorContext): Promise<Conversation>;
  listEvents(conversationId: string, projectId: string, after: string, operator: OperatorContext): Promise<readonly ConversationEvent[]>;
  /** Rebuilds in-memory runtime handles for active conversations after a process restart. */
  recover?(): Promise<{ recovered: number; markedUnknown: number }>;
  close?(): Promise<void>;
}

type RuntimeStreamState = { turnId: string | undefined; requestId: string | undefined; pending: Promise<void>; error: unknown | undefined };
type RuntimeHandle = { execution: import("@maestro/domain").ExecutionRef; invocation: import("@maestro/domain").InvocationRef; runtime: ReturnType<typeof createMaestroAgentRuntime>; binding: GatewayBinding; stream: RuntimeStreamState };
type ConversationRow = { conversation_id: string; operator_id: string; project_id: string; goal_id: string; model_provider: string; model_id: string; status: Conversation["status"]; version: number; binding: GatewayBinding; active_turn_id: string | null; active_request_id: string | null; create_request_id: string | null };

const MAX_TEXT = 64_000;
const MAX_PERSISTED_TEXT_BYTES = 60_000;
const SECRET_LIKE = /(bearer\s+[\w./+=-]{12,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)\s*[:=]|-----begin .*private key-----|(?:^|[^a-z0-9])sk-[a-z0-9_-]{16,})/i;
function boundedText(text: string, maxBytes = MAX_PERSISTED_TEXT_BYTES): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end -= 1;
  if (end < text.length && end > 0) {
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  }
  return text.slice(0, end);
}
function assertSafeText(text: string): void {
  if (text.length > MAX_TEXT || Buffer.byteLength(text, "utf8") > MAX_PERSISTED_TEXT_BYTES || SECRET_LIKE.test(text)) throw new ConversationConflictError("conversation text is invalid or contains credential-like data");
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0 || (code >= 0xd800 && code <= 0xdbff && (index + 1 >= text.length || text.charCodeAt(index + 1) < 0xdc00 || text.charCodeAt(index + 1) > 0xdfff)) || (code >= 0xdc00 && code <= 0xdfff && (index === 0 || text.charCodeAt(index - 1) < 0xd800 || text.charCodeAt(index - 1) > 0xdbff))) throw new ConversationConflictError("conversation text contains invalid Unicode");
  }
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
function terminalEventType(status: Conversation["status"]): ConversationEvent["eventType"] {
  return status === "succeeded" ? "turn_completed" : status === "cancelled" ? "turn_cancelled" : status === "unknown" ? "turn_unknown" : "turn_failed";
}
function turnStatus(status: Conversation["status"]): "completed" | "failed" | "cancelled" | "unknown" {
  return status === "succeeded" ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "unknown";
}
function cancellationContent(status: Conversation["status"]): string {
  return status === "cancelled" ? "Conversation turn cancelled" : "Conversation turn outcome is unavailable";
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

  async function read(conversationId: string, projectId: string, operatorId: string): Promise<ConversationRow> {
    const result = await options.pool.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3", [conversationId, projectId, operatorId]);
    if (result.rowCount !== 1) throw new ConversationNotFoundError();
    return result.rows[0]!;
  }
  async function addEvent(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ cursor: string }> }> }, conversationId: string, projectId: string, eventType: ConversationEvent["eventType"], payload: Record<string, unknown>): Promise<string> {
    const result = await client.query("INSERT INTO conversation_events (event_id, conversation_id, project_id, event_type, payload) VALUES ($1, $2, $3, $4, $5) RETURNING cursor::text", [randomUUID(), conversationId, projectId, eventType, JSON.stringify(payload)]);
    return result.rows[0]!.cursor;
  }

  function grantFor(row: ConversationRow, _accountRef: string) {
    return { grantId: `grant-${row.conversation_id}`, allowedTools: [], allowedSkills: [], modelPolicy: [formatModelRef({ provider: row.model_provider, id: row.model_id })], pathScope: [], outboundDataClasses: ["public", "workspace"], remaining: { modelTurns: 8, toolCalls: 0, childCalls: 0, outputTokens: 8_192, wallTimeMs: 120_000, retryCount: 0 } };
  }
  function createStreamState(): RuntimeStreamState { return { turnId: undefined, requestId: undefined, pending: Promise.resolve(), error: undefined }; }
  function queueTextDelta(state: RuntimeStreamState, conversationId: string, projectId: string, event: import("@maestro/agent-runtime").ModelStreamEvent): void {
    if (event.kind !== "text-delta" || event.text === "" || state.turnId === undefined) return;
    const turnId = state.turnId;
    const chunks: string[] = [];
    for (let offset = 0; offset < event.text.length;) {
      const chunk = boundedText(event.text.slice(offset), 16_000);
      if (chunk === "") break;
      chunks.push(chunk);
      offset += chunk.length;
    }
    state.pending = state.pending.then(async () => {
      for (const text of chunks) {
        await options.pool.query("INSERT INTO conversation_events (event_id, conversation_id, project_id, event_type, payload) VALUES ($1, $2, $3, 'turn_delta', $4)", [randomUUID(), conversationId, projectId, JSON.stringify({ turnId, text })]);
      }
    }).catch((error) => { state.error = error; throw error; });
  }
  async function rebuildRuntime(row: ConversationRow): Promise<RuntimeHandle> {
    const history = await options.pool.query<{ role: "user" | "assistant"; content: string }>("SELECT role, content FROM conversation_turns WHERE conversation_id = $1 AND project_id = $2 AND role IN ('user', 'assistant') ORDER BY created_at ASC, turn_ref ASC, CASE role WHEN 'user' THEN 0 ELSE 1 END, turn_id ASC", [row.conversation_id, row.project_id]);
    const initialMessages: ModelMessage[] = history.rows.map((turn) => ({ role: turn.role, content: [{ kind: "text", text: boundedText(turn.content) }] }));
    const stream = createStreamState();
    const runtime = createMaestroAgentRuntime({ gateway: options.gateway, binding: row.binding, tools, initialMessages, onModelEvent: (event) => queueTextDelta(stream, row.conversation_id, row.project_id, event) });
    const spawned = await runtime.spawn({ name: `conversation-${row.conversation_id}`, context: { operatorId: row.operator_id, projectId: row.project_id, goalId: row.goal_id, missionBundleId: "conversation", policyVersion: "1", accountRef: row.binding.account.accountRef }, grant: grantFor(row, row.binding.account.accountRef), modelPolicy: [formatModelRef({ provider: row.model_provider, id: row.model_id })], idempotencyKey: row.conversation_id });
    return { execution: spawned.execution, invocation: spawned.invocation, runtime, binding: row.binding, stream };
  }
  async function markConversationUnknown(conversationId: string, projectId: string, reason: string, message: string): Promise<void> {
    const client = await options.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 FOR UPDATE", [conversationId, projectId]);
      const current = currentResult.rows[0];
      if (current === undefined || ["succeeded", "failed", "cancelled", "unknown"].includes(current.status)) { await client.query("COMMIT"); return; }
      const existing = await client.query<{ cursor: string }>("SELECT cursor::text AS cursor FROM conversation_events WHERE conversation_id = $1 AND event_type = 'turn_unknown' AND payload->>'reason' = $2 ORDER BY cursor DESC LIMIT 1", [conversationId, reason]);
      if (existing.rowCount === 0) await addEvent(client, conversationId, projectId, "turn_unknown", { status: "unknown", reason, message });
      await client.query("UPDATE conversations SET status = 'unknown', active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status IN ('active', 'running')", [conversationId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  return {
    async listModels(_operator: OperatorContext) {
      const models = await options.gateway.listModels({ operatorId: options.gatewayOperatorId });
      return models.map((model) => ({ ...model, capabilities: [...model.capabilities], authModes: [...model.authModes], dataPolicy: { ...model.dataPolicy, allowedDataClasses: [...model.dataPolicy.allowedDataClasses], regions: [...model.dataPolicy.regions] } }));
    },
    async create(input, operator, requestId = randomUUID()) {
      const normalizedRequestId = UuidSchema.parse(requestId);
      const goal = await options.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [input.goalId]);
      if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId) throw new ConversationConflictError("conversation Goal/project binding is invalid");
      const parsed = parseModelRef(input.model);

      const client = await options.pool.connect();
      let conversationId = randomUUID();
      let binding: GatewayBinding;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3, 0))", [operator.operatorId, input.projectId, normalizedRequestId]);
        const existing = await client.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE operator_id = $1 AND project_id = $2 AND create_request_id = $3", [operator.operatorId, input.projectId, normalizedRequestId]);
        if (existing.rowCount === 1) {
          const row = existing.rows[0]!;
          if (row.goal_id !== input.goalId || formatModelRef({ provider: row.model_provider, id: row.model_id }) !== input.model) throw new ConversationConflictError("idempotency key is bound to a different conversation request");
          await client.query("COMMIT");
          client.release();
          return modelFromRow(row);
        }
        const models = await options.gateway.listModels({ operatorId: options.gatewayOperatorId });
        const catalog = models.find((item) => item.identity.provider === parsed.provider && item.identity.id === parsed.id);
        if (catalog === undefined || !catalog.capabilities.has("text")) throw new ConversationModelNotAllowedError();
        const accountRef = options.accountRefs[parsed.provider] ?? `${parsed.provider}-${operator.operatorId}`;
        conversationId = randomUUID();
        binding = await options.gateway.admit({ requestId: `admit-${normalizedRequestId}`, operatorId: options.gatewayOperatorId, providerId: parsed.provider, model: parsed, accountRef, dataPolicyHash: policyHash });
        await client.query("INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, create_request_id) VALUES ($1, $2, $3, $4, $5, $6, 'active', 1, $7, $8)", [conversationId, operator.operatorId, input.projectId, input.goalId, parsed.provider, parsed.id, JSON.stringify(binding), normalizedRequestId]);
        await addEvent(client, conversationId, input.projectId, "conversation_created", { model: input.model });
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); client.release(); throw error; }
      client.release();

      const stream = createStreamState();
      const runtime = createMaestroAgentRuntime({ gateway: options.gateway, binding: binding!, tools, onModelEvent: (event) => queueTextDelta(stream, conversationId, input.projectId, event) });
      let spawned: Awaited<ReturnType<typeof runtime.spawn>>;
      try {
        spawned = await runtime.spawn({ name: `conversation-${conversationId}`, context: { operatorId: operator.operatorId, projectId: input.projectId, goalId: input.goalId, missionBundleId: "conversation", policyVersion: "1", accountRef: binding!.account.accountRef }, grant: { grantId: `grant-${conversationId}`, allowedTools: [], allowedSkills: [], modelPolicy: [input.model], pathScope: [], outboundDataClasses: ["public", "workspace"], remaining: { modelTurns: 8, toolCalls: 0, childCalls: 0, outputTokens: 8_192, wallTimeMs: 120_000, retryCount: 0 } }, modelPolicy: [input.model], idempotencyKey: conversationId });
      } catch {
        await markConversationUnknown(conversationId, input.projectId, "runtime_admission_failed", "Conversation runtime admission failed");
        await runtime.close?.();
        throw new ConversationUnavailableError("conversation runtime admission failed");
      }
      runtimes.set(conversationId, { execution: spawned.execution, invocation: spawned.invocation, runtime, binding: binding!, stream });
      return { conversationId, projectId: input.projectId, goalId: input.goalId, model: input.model, status: "active", version: 1 };
    },
    async get(conversationId, projectId, operator) { return modelFromRow(await read(conversationId, projectId, operator.operatorId)); },
    async turn(conversationId, input, _operator, requestId = randomUUID()) {
      assertSafeText(input.text);
      const normalizedRequestId = UuidSchema.parse(requestId);
      const row = await read(conversationId, input.projectId, _operator.operatorId);
      const prior = await options.pool.query<{ turn_ref: string; content: string }>("SELECT turn_ref, content FROM conversation_turns WHERE conversation_id = $1 AND request_id = $2 AND role = 'user'", [conversationId, normalizedRequestId]);
      if (prior.rowCount !== 0) {
        if (prior.rows[0]!.content !== input.text) throw new ConversationConflictError("idempotency key is bound to different turn text");
        const assistant = await options.pool.query<{ turn_id: string; content: string; status: "completed" | "failed" | "cancelled" | "unknown"; cursor: string; created_at: Date }>("SELECT turn_id, content, status, cursor::text AS cursor, created_at FROM conversation_turns WHERE conversation_id = $1 AND turn_ref = $2 AND role = 'assistant'", [conversationId, prior.rows[0]!.turn_ref]);
        if (assistant.rowCount !== 1) throw new ConversationConflictError("conversation turn is already in progress");
        const replay = assistant.rows[0]!;
        const current = await read(conversationId, input.projectId, _operator.operatorId);
        return { conversation: modelFromRow(current), turn: { turnId: UuidSchema.parse(replay.turn_id), conversationId, role: "assistant" as const, content: replay.content, status: replay.status, cursor: replay.cursor, createdAt: replay.created_at.toISOString() } };
      }
      if (row.status === "unknown" || row.status === "cancelled") throw new ConversationUnavailableError("conversation is not resumable");
      const handle = runtimes.get(conversationId);
      if (handle === undefined) throw new ConversationUnavailableError("conversation runtime is unavailable after restart");
      const turnId = randomUUID();
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [conversationId, normalizedRequestId]);
        const lockedPrior = await client.query<{ turn_ref: string; content: string }>("SELECT turn_ref, content FROM conversation_turns WHERE conversation_id = $1 AND request_id = $2 AND role = 'user'", [conversationId, normalizedRequestId]);
        if (lockedPrior.rowCount !== 0) {
          if (lockedPrior.rows[0]!.content !== input.text) throw new ConversationConflictError("idempotency key is bound to different turn text");
          const lockedAssistant = await client.query<{ turn_id: string; content: string; status: "completed" | "failed" | "cancelled" | "unknown"; cursor: string; created_at: Date }>("SELECT turn_id, content, status, cursor::text AS cursor, created_at FROM conversation_turns WHERE conversation_id = $1 AND turn_ref = $2 AND role = 'assistant'", [conversationId, lockedPrior.rows[0]!.turn_ref]);
          if (lockedAssistant.rowCount !== 1) throw new ConversationConflictError("conversation turn is already in progress");
          const replay = lockedAssistant.rows[0]!;
          const currentResult = await client.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3 FOR UPDATE", [conversationId, input.projectId, _operator.operatorId]);
          if (currentResult.rowCount !== 1) throw new ConversationNotFoundError();
          const current = currentResult.rows[0]!;
          await client.query("COMMIT");
          client.release();
          return { conversation: modelFromRow(current), turn: { turnId: UuidSchema.parse(replay.turn_id), conversationId, role: "assistant" as const, content: replay.content, status: replay.status, cursor: replay.cursor, createdAt: replay.created_at.toISOString() } };
        }
        const claimed = await client.query("UPDATE conversations SET status = 'running', active_turn_id = $3, active_request_id = $4, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND version = $2 AND status NOT IN ('running', 'cancelled', 'unknown')", [conversationId, row.version, turnId, normalizedRequestId]);
        if (claimed.rowCount !== 1) throw new ConversationConflictError("conversation already has an active turn");
        await client.query("INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'user', $6, 'accepted', 0)", [randomUUID(), turnId, normalizedRequestId, conversationId, input.projectId, input.text]);
        await addEvent(client, conversationId, input.projectId, "turn_started", { turnId, text: input.text });
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); client.release(); throw error; }
      client.release();
      handle.stream.turnId = turnId;
      handle.stream.requestId = normalizedRequestId;
      handle.stream.pending = Promise.resolve();
      handle.stream.error = undefined;
      let observed: Awaited<ReturnType<typeof handle.runtime.observe>>[number] | undefined;
      try {
        try { await handle.runtime.prompt(handle.execution, input.text); } catch { observed = undefined; }
        observed = (await handle.runtime.observe(handle.execution)).find((item) => item.invocation === handle.invocation);
      } catch { observed = undefined; }
      let streamWriteFailed = false;
      try { await handle.stream.pending; } catch { streamWriteFailed = true; }
      let status: Conversation["status"] = streamWriteFailed ? "unknown" : statusFromObservation(observed?.status ?? "unknown");
      let content = observed?.answer.state === "available" ? observed.answer.text : status === "failed" ? "Model turn failed" : status === "cancelled" ? cancellationContent("cancelled") : "Model turn outcome is unavailable";
      const resultClient = await options.pool.connect();
      let completedCursor: string;
      let finalConversation: Conversation;
      try {
        await resultClient.query("BEGIN");
        const currentResult = await resultClient.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3 FOR UPDATE", [conversationId, input.projectId, _operator.operatorId]);
        if (currentResult.rowCount !== 1) throw new ConversationNotFoundError();
        const current = currentResult.rows[0]!;
        if (current.status !== "running") {
          status = current.status === "active" ? status : current.status;
          if (status === "cancelled" || status === "unknown") content = cancellationContent(status);
        }
        const existingTerminal = await resultClient.query<{ cursor: string }>("SELECT cursor::text AS cursor FROM conversation_events WHERE conversation_id = $1 AND project_id = $2 AND event_type IN ('turn_completed', 'turn_failed', 'turn_cancelled', 'turn_unknown') AND payload->>'turnId' = $3 ORDER BY cursor DESC LIMIT 1", [conversationId, input.projectId, turnId]);
        completedCursor = existingTerminal.rowCount === 1 ? existingTerminal.rows[0]!.cursor : await addEvent(resultClient, conversationId, input.projectId, terminalEventType(status), { status, turnId, ...(status === "succeeded" ? { content: boundedText(content) } : { message: boundedText(content, 2_000) }) });
        await resultClient.query("INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'assistant', $6, $7, $8) ON CONFLICT (turn_id) DO NOTHING", [turnId, turnId, normalizedRequestId, conversationId, input.projectId, boundedText(content), turnStatus(status), completedCursor]);
        if (current.status === "running") {
          await resultClient.query("UPDATE conversations SET status = $2, active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status = 'running'", [conversationId, status]);
          finalConversation = { ...modelFromRow(current), status, version: current.version + 1 };
        } else {
          finalConversation = modelFromRow(current);
        }
        await resultClient.query("COMMIT");
      } catch (error) { await resultClient.query("ROLLBACK"); resultClient.release(); throw error; }
      resultClient.release();
      handle.stream.turnId = undefined;
      handle.stream.requestId = undefined;
      return { conversation: finalConversation!, turn: { turnId, conversationId, role: "assistant" as const, content: boundedText(content), status: turnStatus(status), cursor: completedCursor!, createdAt: now() } };
    },
    async cancel(conversationId, projectId, operator) {
      await read(conversationId, projectId, operator.operatorId);
      const handle = runtimes.get(conversationId);
      if (handle !== undefined) {
        handle.stream.turnId = undefined;
        handle.stream.requestId = undefined;
        try { await handle.runtime.cancel(handle.invocation); } catch { /* status is resolved from the runtime fence below */ }
        await handle.stream.pending.catch(() => undefined);
      }
      const next: Conversation["status"] = handle === undefined ? "unknown" : await handle.runtime.getInvocationStatus(handle.invocation) === "cancelled" ? "cancelled" : "unknown";
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        const currentResult = await client.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3 FOR UPDATE", [conversationId, projectId, operator.operatorId]);
        if (currentResult.rowCount !== 1) throw new ConversationNotFoundError();
        const current = currentResult.rows[0]!;
        if (["succeeded", "failed", "cancelled", "unknown"].includes(current.status)) {
          await client.query("COMMIT");
          return modelFromRow(current);
        }
        const turnId = current.active_turn_id;
        const requestId = current.active_request_id ?? randomUUID();
        const message = cancellationContent(next);
        const cursor = await addEvent(client, conversationId, projectId, terminalEventType(next), { status: next, ...(turnId === undefined ? {} : { turnId }), message });
        if (turnId !== undefined) {
          await client.query("INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'assistant', $6, $7, $8) ON CONFLICT (turn_id) DO NOTHING", [turnId, turnId, requestId, conversationId, projectId, message, turnStatus(next), cursor]);
        }
        await client.query("UPDATE conversations SET status = $2, active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status IN ('active', 'running')", [conversationId, next]);
        await client.query("COMMIT");
        return { ...modelFromRow(current), status: next, version: current.version + 1 };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
    async listEvents(conversationId, projectId, after, operator) {
      await read(conversationId, projectId, operator.operatorId);
      const result = await options.pool.query<{ cursor: string; event_id: string; conversation_id: string; project_id: string; event_type: ConversationEvent["eventType"]; payload: Record<string, unknown>; occurred_at: string }>("SELECT cursor::text AS cursor, event_id, conversation_id, project_id, event_type, payload, occurred_at FROM conversation_events WHERE conversation_id = $1 AND project_id = $2 AND cursor > $3::bigint ORDER BY cursor ASC LIMIT 256", [conversationId, projectId, after]);
      return result.rows.map((row) => ({ cursor: row.cursor, eventId: row.event_id, conversationId: row.conversation_id, projectId: row.project_id, eventType: row.event_type, payload: row.payload, occurredAt: new Date(row.occurred_at).toISOString() }));
    },
    async recover() {
      const rows = await options.pool.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE status IN ('active', 'running') ORDER BY created_at ASC");
      let recovered = 0; let markedUnknown = 0;
      for (const row of rows.rows) {
        if (row.active_turn_id !== null) {
          const client = await options.pool.connect();
          try {
            await client.query("BEGIN");
            const currentResult = await client.query<ConversationRow>("SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 FOR UPDATE", [row.conversation_id]);
            const current = currentResult.rows[0];
            if (current !== undefined && current.active_turn_id !== null && !["succeeded", "failed", "cancelled", "unknown"].includes(current.status)) {
              const turnId = current.active_turn_id;
              const existing = await client.query<{ cursor: string }>("SELECT cursor::text AS cursor FROM conversation_events WHERE conversation_id = $1 AND event_type = 'turn_unknown' AND payload->>'turnId' = $2 ORDER BY cursor DESC LIMIT 1", [row.conversation_id, turnId]);
              const message = cancellationContent("unknown");
              const cursor = existing.rowCount === 1 ? existing.rows[0]!.cursor : await addEvent(client, row.conversation_id, row.project_id, "turn_unknown", { status: "unknown", turnId, message });
              await client.query("INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'assistant', $6, 'unknown', $7) ON CONFLICT (turn_id) DO NOTHING", [turnId, turnId, current.active_request_id ?? randomUUID(), row.conversation_id, row.project_id, message, cursor]);
              await client.query("UPDATE conversations SET status = 'unknown', active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status IN ('active', 'running')", [row.conversation_id]);
              markedUnknown += 1;
            }
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
          continue;
        }
        try {
          const handle = await rebuildRuntime(row);
          runtimes.set(row.conversation_id, handle);
          recovered += 1;
        } catch {
          await markConversationUnknown(row.conversation_id, row.project_id, "runtime_rebuild_failed", "Conversation runtime recovery failed");
          markedUnknown += 1;
        }
      }
      return { recovered, markedUnknown };
    },
    async close() { await Promise.all([...runtimes.values()].map(async (handle) => { await handle.runtime.close?.(); })); runtimes.clear(); },
  };
}
