import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { OperatorContext } from "@maestro/persistence";
import {
  appendConversationEvent,
  appendTurnDelta,
  cancelConversationTurn,
  claimConversationTurn,
  fenceInterruptedTurn,
  finalizeConversationTurn,
  findAssistantTurn,
  findTurnByRequest,
  listActiveConversations,
  listConversationEvents,
  listConversationSummaries,
  markConversationUnknown,
  readConversationRecord,
  type AssistantTurnRow,
} from "@maestro/persistence";
import {
  UuidSchema,
  ConversationActivityEventSchema,
  type ConversationActivityEvent,
  type Conversation,
  type ConversationEvent,
  type ConversationSummary,
  type ConversationTurnInput,
  type ConversationTurnResult,
  type CreateConversationInput,
  type ModelCatalogEntry,
} from "@maestro/contracts";
import {
  buildMaestroSystemPrompt,
  createMaestroAgentRuntime,
  ToolRegistry,
  parseModelRef,
  formatModelRef,
  type ModelGatewayPort,
  type GatewayBinding,
  type MaestroPersonaContext,
  type ModelMessage,
} from "@maestro/agent-runtime";

import {
  ConversationConflictError,
  ConversationModelNotAllowedError,
  ConversationNotFoundError,
  ConversationUnavailableError,
  modelActivity,
} from "./conversation/text.js";

export {
  ConversationConflictError,
  ConversationModelNotAllowedError,
  ConversationNotFoundError,
  ConversationUnavailableError,
  modelActivity,
};
import {
  assertSafeText,
  modelFromRow,
  now,
  statusFromObservation,
  type ConversationRow,
} from "./conversation/text.js";
import { boundedText, cancellationContent, turnStatus } from "@maestro/contracts";

export interface ConversationService {
  listModels(operator: OperatorContext): Promise<readonly ModelCatalogEntry[]>;
  create(input: CreateConversationInput, operator: OperatorContext, requestId?: string): Promise<Conversation>;
  get(conversationId: string, projectId: string, operator: OperatorContext): Promise<Conversation>;
  turn(
    conversationId: string,
    input: ConversationTurnInput,
    operator: OperatorContext,
    requestId?: string,
  ): Promise<ConversationTurnResult>;
  cancel(conversationId: string, projectId: string, operator: OperatorContext): Promise<Conversation>;
  listEvents(conversationId: string, projectId: string, after: string, operator: OperatorContext): Promise<readonly ConversationEvent[]>;
  /** The operator's Concertmaster sessions in one project, most recently active first. */
  list?(projectId: string, limit: number, operator: OperatorContext): Promise<readonly ConversationSummary[]>;
  /** Best-effort, non-replayable live activity. Payloads exclude reasoning text, tool arguments, and tool output. */
  subscribeActivity?(
    conversationId: string,
    projectId: string,
    operator: OperatorContext,
    listener: (event: ConversationActivityEvent) => void,
  ): Promise<() => void>;
  /** Rebuilds in-memory runtime handles for active conversations after a process restart. */
  recover?(): Promise<{ recovered: number; markedUnknown: number }>;
  close?(): Promise<void>;
}

type RuntimeStreamState = { turnId: string | undefined; requestId: string | undefined; pending: Promise<void>; error: unknown | undefined };
type RuntimeHandle = {
  execution: import("@maestro/domain").ExecutionRef;
  invocation: import("@maestro/domain").InvocationRef;
  runtime: ReturnType<typeof createMaestroAgentRuntime>;
  binding: GatewayBinding;
  stream: RuntimeStreamState;
};

function buildReplayTurn(
  conversationId: string,
  current: ConversationRow,
  replay: AssistantTurnRow,
): { conversation: Conversation; turn: { turnId: string; conversationId: string; role: "assistant"; content: string; status: AssistantTurnRow["status"]; cursor: string; createdAt: string } } {
  return {
    conversation: modelFromRow(current),
    turn: {
      turnId: UuidSchema.parse(replay.turn_id),
      conversationId,
      role: "assistant" as const,
      content: replay.content,
      status: replay.status,
      cursor: replay.cursor,
      createdAt: replay.created_at.toISOString(),
    },
  };
}
export function createPostgresConversationService(options: {
  pool: Pool;
  gateway: ModelGatewayPort;
  gatewayOperatorId: string;
  accountRefs: Readonly<Record<string, string>>;
  dataPolicyHash?: string;
  tools?: ToolRegistry;
  /** Read-only session `ipython` tool for each conversation's workspace. */
  sessionTools?: (scope: { projectId: string; conversationId: string }) => ToolRegistry;
  /** Resolves the persisted role/task-class persona before a model turn starts. */
  personaResolver?: (input: {
    readonly roleId: string;
    readonly taskClass: string;
    readonly projectId: string;
    readonly goalId: string | null;
  }) => Promise<MaestroPersonaContext>;
}): ConversationService {
  const runtimes = new Map<string, RuntimeHandle>();
  const activitySubscribers = new Map<string, Set<(event: ConversationActivityEvent) => void>>();
  const activityKey = (conversationId: string, projectId: string): string => `${conversationId}:${projectId}`;
  const publishActivity = (
    conversationId: string,
    projectId: string,
    turnId: string,
    event: import("@maestro/agent-runtime").ModelStreamEvent,
  ): void => {
    const mapped = modelActivity(event);
    if (mapped === undefined) return;
    const activity = ConversationActivityEventSchema.parse({
      activityId: randomUUID(),
      conversationId,
      projectId,
      turnId,
      ...mapped,
      occurredAt: now(),
    });
    for (const listener of activitySubscribers.get(activityKey(conversationId, projectId)) ?? []) {
      try {
        listener(activity);
      } catch {
        /* a disconnected SSE client must not affect the turn */
      }
    }
  };
  const sharedTools = options.tools ?? new ToolRegistry();
  const toolsFor = (projectId: string, conversationId: string) =>
    options.sessionTools === undefined ? sharedTools : options.sessionTools({ projectId, conversationId });
  const sessionToolGrant = () =>
    options.sessionTools === undefined ? { allowedTools: [] as string[], toolCalls: 0 } : { allowedTools: ["ipython"], toolCalls: 8 };
  const policyHash = options.dataPolicyHash ?? "maestro-local-v1";

  async function conversationSystemPrompt(projectId: string, goalId: string | null): Promise<string> {
    const persona =
      options.personaResolver === undefined
        ? undefined
        : await options.personaResolver({ roleId: "concertmaster", taskClass: "conversation", projectId, goalId });
    const prompt = buildMaestroSystemPrompt(persona);
    return options.sessionTools === undefined
      ? prompt
      : `${prompt}\n\nThe Overture crew reads every message in this conversation and writes plan, design, and task files into the session workspace on its own, so never tell the operator that files cannot be written or ask them to start Overture: acknowledge the request briefly and let the crew do the drafting. You can consult those files with the ipython tool's read-only helpers list_files() and read_file(path); you do not write files yourself.`;
  }

  async function read(conversationId: string, projectId: string, operatorId: string): Promise<ConversationRow> {
    const row = await readConversationRecord(options.pool, conversationId, projectId, operatorId);
    if (row === null) throw new ConversationNotFoundError();
    return row;
  }

  function grantFor(row: ConversationRow, _accountRef: string) {
    // Ordinary Concertmaster conversations are conversational only. Overture
    // owns planning tools and will receive a separate, explicit grant later.
    return {
      grantId: `grant-${row.conversation_id}`,
      allowedTools: sessionToolGrant().allowedTools,
      allowedSkills: [],
      modelPolicy: [formatModelRef({ provider: row.model_provider, id: row.model_id })],
      pathScope: [],
      outboundDataClasses: ["public", "workspace"],
      remaining: {
        modelTurns: 8,
        toolCalls: sessionToolGrant().toolCalls,
        childCalls: 0,
        outputTokens: 8_192,
        wallTimeMs: 120_000,
        retryCount: 0,
      },
    };
  }
  function createStreamState(): RuntimeStreamState {
    return { turnId: undefined, requestId: undefined, pending: Promise.resolve(), error: undefined };
  }
  function queueTextDelta(
    state: RuntimeStreamState,
    conversationId: string,
    projectId: string,
    event: import("@maestro/agent-runtime").ModelStreamEvent,
  ): void {
    if (event.kind !== "text-delta" || event.text === "" || state.turnId === undefined) return;
    const turnId = state.turnId;
    const chunks: string[] = [];
    for (let offset = 0; offset < event.text.length;) {
      const chunk = boundedText(event.text.slice(offset), 16_000);
      if (chunk === "") break;
      chunks.push(chunk);
      offset += chunk.length;
    }
    state.pending = state.pending
      .then(async () => {
        for (const text of chunks) {
          await appendTurnDelta(options.pool, conversationId, projectId, turnId, text);
        }
      })
      .catch((error) => {
        state.error = error;
        throw error;
      });
  }
  async function rebuildRuntime(row: ConversationRow): Promise<RuntimeHandle> {
    const history = await options.pool.query<{ role: "user" | "assistant"; content: string }>(
      "SELECT role, content FROM conversation_turns WHERE conversation_id = $1 AND project_id = $2 AND role IN ('user', 'assistant') ORDER BY created_at ASC, turn_ref ASC, CASE role WHEN 'user' THEN 0 ELSE 1 END, turn_id ASC",
      [row.conversation_id, row.project_id],
    );
    const initialMessages: ModelMessage[] = history.rows.map((turn) => ({
      role: turn.role,
      content: [{ kind: "text", text: boundedText(turn.content) }],
    }));
    const stream = createStreamState();
    const runtime = createMaestroAgentRuntime({
      gateway: options.gateway,
      binding: row.binding,
      tools: toolsFor(row.project_id, row.conversation_id),
      systemPrompt: await conversationSystemPrompt(row.project_id, row.goal_id),
      initialMessages,
      onModelEvent: (event) => {
        queueTextDelta(stream, row.conversation_id, row.project_id, event);
        if (stream.turnId !== undefined) publishActivity(row.conversation_id, row.project_id, stream.turnId, event);
      },
    });
    const spawned = await runtime.spawn({
      name: `conversation-${row.conversation_id}`,
      context: {
        operatorId: row.operator_id,
        projectId: row.project_id,
        ...(row.goal_id === null ? {} : { goalId: row.goal_id }),
        missionBundleId: "conversation",
        policyVersion: "1",
        accountRef: row.binding.account.accountRef,
      },
      grant: grantFor(row, row.binding.account.accountRef),
      modelPolicy: [formatModelRef({ provider: row.model_provider, id: row.model_id })],
      idempotencyKey: row.conversation_id,
    });
    return { execution: spawned.execution, invocation: spawned.invocation, runtime, binding: row.binding, stream };
  }

  return {
    async listModels(_operator: OperatorContext) {
      const models = await options.gateway.listModels({ operatorId: options.gatewayOperatorId });
      return models.map((model) => ({
        ...model,
        capabilities: [...model.capabilities],
        authModes: [...model.authModes],
        dataPolicy: {
          ...model.dataPolicy,
          allowedDataClasses: [...model.dataPolicy.allowedDataClasses],
          regions: [...model.dataPolicy.regions],
        },
      }));
    },
    async create(input, operator, requestId = randomUUID()) {
      const normalizedRequestId = UuidSchema.parse(requestId);
      const goalId = input.goalId ?? null;
      if (goalId !== null) {
        const goal = await options.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
        if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId)
          throw new ConversationConflictError("conversation Goal/project binding is invalid");
      }
      const parsed = parseModelRef(input.model);
      const systemPrompt = await conversationSystemPrompt(input.projectId, goalId);

      const client = await options.pool.connect();
      let conversationId = randomUUID();
      let binding: GatewayBinding;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3, 0))", [
          operator.operatorId,
          input.projectId,
          normalizedRequestId,
        ]);
        const existing = await client.query<ConversationRow>(
          "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE operator_id = $1 AND project_id = $2 AND create_request_id = $3",
          [operator.operatorId, input.projectId, normalizedRequestId],
        );
        if (existing.rowCount === 1) {
          const row = existing.rows[0]!;
          if (row.goal_id !== goalId || formatModelRef({ provider: row.model_provider, id: row.model_id }) !== input.model)
            throw new ConversationConflictError("idempotency key is bound to a different conversation request");
          await client.query("COMMIT");
          client.release();
          return modelFromRow(row);
        }
        const models = await options.gateway.listModels({ operatorId: options.gatewayOperatorId });
        const catalog = models.find((item) => item.identity.provider === parsed.provider && item.identity.id === parsed.id);
        if (catalog === undefined || !catalog.capabilities.has("text")) throw new ConversationModelNotAllowedError();
        if (input.reasoningEffort !== undefined && !catalog.reasoningEfforts?.supported.includes(input.reasoningEffort))
          throw new ConversationModelNotAllowedError();
        // Intentional wart: gateway admit stays inside this txn because the
        // gateway performs no requestId dedup, so hoisting admit out could
        // leak orphan provider sessions on concurrent same-key creates.
        // Extraction awaits an idempotent re-admit/read or orphan-reaper.
        const accountRef = options.accountRefs[parsed.provider] ?? `${parsed.provider}-${operator.operatorId}`;
        conversationId = randomUUID();
        binding = await options.gateway.admit({
          requestId: `admit-${normalizedRequestId}`,
          operatorId: options.gatewayOperatorId,
          providerId: parsed.provider,
          model: parsed,
          accountRef,
          dataPolicyHash: policyHash,
          ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        });
        await client.query(
          "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, create_request_id) VALUES ($1, $2, $3, $4, $5, $6, 'active', 1, $7, $8)",
          [
            conversationId,
            operator.operatorId,
            input.projectId,
            goalId,
            parsed.provider,
            parsed.id,
            JSON.stringify(binding),
            normalizedRequestId,
          ],
        );
        await appendConversationEvent(client, conversationId, input.projectId, "conversation_created", { model: input.model });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        client.release();
        throw error;
      }
      client.release();

      const stream = createStreamState();
      const runtime = createMaestroAgentRuntime({
        gateway: options.gateway,
        binding: binding!,
        tools: toolsFor(input.projectId, conversationId),
        systemPrompt,
        onModelEvent: (event) => {
          queueTextDelta(stream, conversationId, input.projectId, event);
          if (stream.turnId !== undefined) publishActivity(conversationId, input.projectId, stream.turnId, event);
        },
      });
      let spawned: Awaited<ReturnType<typeof runtime.spawn>>;
      try {
        spawned = await runtime.spawn({
          name: `conversation-${conversationId}`,
          context: {
            operatorId: operator.operatorId,
            projectId: input.projectId,
            ...(goalId === null ? {} : { goalId }),
            missionBundleId: "conversation",
            policyVersion: "1",
            accountRef: binding!.account.accountRef,
          },
          grant: {
            grantId: `grant-${conversationId}`,
            // Concertmaster conversations may only read their session
            // workspace; planning writes belong to Overture's grant.
            allowedTools: sessionToolGrant().allowedTools,
            allowedSkills: [],
            modelPolicy: [input.model],
            pathScope: [],
            outboundDataClasses: ["public", "workspace"],
            remaining: {
              modelTurns: 8,
              toolCalls: sessionToolGrant().toolCalls,
              childCalls: 0,
              outputTokens: 8_192,
              wallTimeMs: 120_000,
              retryCount: 0,
            },
          },
          modelPolicy: [input.model],
          idempotencyKey: conversationId,
        });
      } catch {
        await markConversationUnknown(options.pool, conversationId, input.projectId, "runtime_admission_failed", "Conversation runtime admission failed");
        await runtime.close?.();
        throw new ConversationUnavailableError("conversation runtime admission failed");
      }
      runtimes.set(conversationId, { execution: spawned.execution, invocation: spawned.invocation, runtime, binding: binding!, stream });
      return { conversationId, projectId: input.projectId, goalId, model: input.model, reasoningEffort: binding!.reasoningEffort ?? null, status: "active", version: 1 };
    },
    async list(projectId, limit, operator) {
      return listConversationSummaries(options.pool, { operatorId: operator.operatorId, projectId, limit });
    },
    async get(conversationId, projectId, operator) {
      return modelFromRow(await read(conversationId, projectId, operator.operatorId));
    },
    async turn(conversationId, input, _operator, requestId = randomUUID()) {
      assertSafeText(input.text);
      const normalizedRequestId = UuidSchema.parse(requestId);
      const row = await read(conversationId, input.projectId, _operator.operatorId);
      const prior = await findTurnByRequest(options.pool, conversationId, normalizedRequestId);
      if (prior !== null) {
        if (prior.content !== input.text) throw new ConversationConflictError("idempotency key is bound to different turn text");
        const assistant = await findAssistantTurn(options.pool, conversationId, prior.turn_ref);
        if (assistant === null) throw new ConversationConflictError("conversation turn is already in progress");
        const current = await read(conversationId, input.projectId, _operator.operatorId);
        return buildReplayTurn(conversationId, current, assistant);
      }
      if (row.status === "unknown" || row.status === "cancelled") throw new ConversationUnavailableError("conversation is not resumable");
      const handle = runtimes.get(conversationId);
      if (handle === undefined) throw new ConversationUnavailableError("conversation runtime is unavailable after restart");
      const turnId = randomUUID();
      const claim = await claimConversationTurn(options.pool, {
        conversationId,
        projectId: input.projectId,
        operatorId: _operator.operatorId,
        turnId,
        requestId: normalizedRequestId,
        text: input.text,
        version: row.version,
      });
      if (claim.kind === "replay") return buildReplayTurn(conversationId, claim.conversation, claim.turn);
      if (claim.kind === "not-found") throw new ConversationNotFoundError();
      if (claim.kind === "conflict") {
        if (claim.reason === "text-mismatch") throw new ConversationConflictError("idempotency key is bound to different turn text");
        if (claim.reason === "in-progress") throw new ConversationConflictError("conversation turn is already in progress");
        throw new ConversationConflictError("conversation already has an active turn");
      }
      handle.stream.turnId = turnId;
      handle.stream.requestId = normalizedRequestId;
      handle.stream.pending = Promise.resolve();
      handle.stream.error = undefined;
      let observed: Awaited<ReturnType<typeof handle.runtime.observe>>[number] | undefined;
      try {
        try {
          await handle.runtime.prompt(handle.execution, input.text);
        } catch {
          observed = undefined;
        }
        observed = (await handle.runtime.observe(handle.execution)).find((item) => item.invocation === handle.invocation);
      } catch {
        observed = undefined;
      }
      let streamWriteFailed = false;
      try {
        await handle.stream.pending;
      } catch {
        streamWriteFailed = true;
      }
      const status: Conversation["status"] = streamWriteFailed ? "unknown" : statusFromObservation(observed?.status ?? "unknown");
      const content =
        observed?.answer.state === "available"
          ? observed.answer.text
          : status === "failed"
            ? "Model turn failed"
            : status === "cancelled"
              ? cancellationContent("cancelled")
              : "Model turn outcome is unavailable";
      const finalized = await finalizeConversationTurn(options.pool, {
        conversationId,
        projectId: input.projectId,
        operatorId: _operator.operatorId,
        turnId,
        requestId: normalizedRequestId,
        status,
        content,
      });
      if (finalized.kind === "not-found") throw new ConversationNotFoundError();
      const finalConversation = finalized.wasRunning
        ? { ...modelFromRow(finalized.conversation), status: finalized.status, version: finalized.conversation.version + 1 }
        : modelFromRow(finalized.conversation);
      publishActivity(conversationId, input.projectId, turnId, {
        kind: "terminal",
        cursor: 0,
        status: finalized.status === "succeeded" ? "succeeded" : finalized.status === "failed" ? "failed" : finalized.status === "cancelled" ? "cancelled" : "unknown",
      });
      handle.stream.turnId = undefined;
      handle.stream.requestId = undefined;
      return {
        conversation: finalConversation,
        turn: {
          turnId,
          conversationId,
          role: "assistant" as const,
          content: boundedText(finalized.content),
          status: turnStatus(finalized.status),
          cursor: finalized.cursor,
          createdAt: now(),
        },
      };
    },
    async cancel(conversationId, projectId, operator) {
      await read(conversationId, projectId, operator.operatorId);
      const handle = runtimes.get(conversationId);
      if (handle !== undefined) {
        handle.stream.turnId = undefined;
        handle.stream.requestId = undefined;
        try {
          await handle.runtime.cancel(handle.invocation);
        } catch {
          /* status is resolved from the runtime fence below */
        }
        await handle.stream.pending.catch(() => undefined);
      }
      const next: Conversation["status"] =
        handle === undefined
          ? "unknown"
          : (await handle.runtime.getInvocationStatus(handle.invocation)) === "cancelled"
            ? "cancelled"
            : "unknown";
      const message = cancellationContent(next);
      const outcome = await cancelConversationTurn(options.pool, {
        conversationId,
        projectId,
        operatorId: operator.operatorId,
        next,
        message,
      });
      if (outcome.kind === "not-found") throw new ConversationNotFoundError();
      if (outcome.kind === "echo") return modelFromRow(outcome.conversation);
      return { ...modelFromRow(outcome.conversation), status: next, version: outcome.conversation.version + 1 };
    },
    async listEvents(conversationId, projectId, after, operator) {
      await read(conversationId, projectId, operator.operatorId);
      return listConversationEvents(options.pool, conversationId, projectId, after);
    },
    async subscribeActivity(conversationId, projectId, operator, listener) {
      await read(conversationId, projectId, operator.operatorId);
      const key = activityKey(conversationId, projectId);
      const listeners = activitySubscribers.get(key) ?? new Set<(event: ConversationActivityEvent) => void>();
      listeners.add(listener);
      activitySubscribers.set(key, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) activitySubscribers.delete(key);
      };
    },
    async recover() {
      const rows = await listActiveConversations(options.pool);
      let recovered = 0;
      let markedUnknown = 0;
      for (const row of rows) {
        if (row.active_turn_id !== null) {
          const fenced = await fenceInterruptedTurn(options.pool, { conversationId: row.conversation_id });
          if (fenced.kind === "fenced") markedUnknown += 1;
          continue;
        }
        try {
          const handle = await rebuildRuntime(row);
          runtimes.set(row.conversation_id, handle);
          recovered += 1;
        } catch {
          await markConversationUnknown(
            options.pool,
            row.conversation_id,
            row.project_id,
            "runtime_rebuild_failed",
            "Conversation runtime recovery failed",
          );
          markedUnknown += 1;
        }
      }
      return { recovered, markedUnknown };
    },
    async close() {
      await Promise.all(
        [...runtimes.values()].map(async (handle) => {
          await handle.runtime.close?.();
        }),
      );
      runtimes.clear();
      activitySubscribers.clear();
    },
  };
}
