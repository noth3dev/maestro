import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GatewayBinding } from "@maestro/agent-runtime";
import type { Conversation, ConversationEvent } from "@maestro/contracts";
import { boundedText, cancellationContent, terminalEventType, turnStatus } from "@maestro/contracts";

export interface ConversationRecord {
  conversation_id: string;
  operator_id: string;
  project_id: string;
  goal_id: string | null;
  model_provider: string;
  model_id: string;
  status: Conversation["status"];
  version: number;
  binding: GatewayBinding;
  active_turn_id: string | null;
  active_request_id: string | null;
  create_request_id: string | null;
}

export async function readConversationRecord(
  pool: Pool,
  conversationId: string,
  projectId: string,
  operatorId: string,
): Promise<ConversationRecord | null> {
  const result = await pool.query<ConversationRecord>(
    "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3",
    [conversationId, projectId, operatorId],
  );
  return result.rows[0] ?? null;
}

export async function appendConversationEvent(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ cursor: string }> }> },
  conversationId: string,
  projectId: string,
  eventType: ConversationEvent["eventType"],
  payload: Record<string, unknown>,
): Promise<string> {
  const result = await client.query(
    "INSERT INTO conversation_events (event_id, conversation_id, project_id, event_type, payload) VALUES ($1, $2, $3, $4, $5) RETURNING cursor::text",
    [randomUUID(), conversationId, projectId, eventType, JSON.stringify(payload)],
  );
  return result.rows[0]!.cursor;
}

export async function appendTurnDelta(pool: Pool, conversationId: string, projectId: string, turnId: string, text: string): Promise<void> {
  await pool.query(
    "INSERT INTO conversation_events (event_id, conversation_id, project_id, event_type, payload) VALUES ($1, $2, $3, 'turn_delta', $4)",
    [randomUUID(), conversationId, projectId, JSON.stringify({ turnId, text })],
  );
}

export async function markConversationUnknown(
  pool: Pool,
  conversationId: string,
  projectId: string,
  reason: string,
  message: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<ConversationRecord>(
      "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 FOR UPDATE",
      [conversationId, projectId],
    );
    const current = currentResult.rows[0];
    if (current === undefined || ["succeeded", "failed", "cancelled", "unknown"].includes(current.status)) {
      await client.query("COMMIT");
      return;
    }
    const existing = await client.query<{ cursor: string }>(
      "SELECT cursor::text AS cursor FROM conversation_events WHERE conversation_id = $1 AND event_type = 'turn_unknown' AND payload->>'reason' = $2 ORDER BY cursor DESC LIMIT 1",
      [conversationId, reason],
    );
    if (existing.rowCount === 0)
      await appendConversationEvent(client, conversationId, projectId, "turn_unknown", { status: "unknown", reason, message });
    await client.query(
      "UPDATE conversations SET status = 'unknown', active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status IN ('active', 'running')",
      [conversationId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listConversationEvents(
  pool: Pool,
  conversationId: string,
  projectId: string,
  after: string,
): Promise<ConversationEvent[]> {
  const result = await pool.query<{
    cursor: string;
    event_id: string;
    conversation_id: string;
    project_id: string;
    event_type: ConversationEvent["eventType"];
    payload: Record<string, unknown>;
    occurred_at: string;
  }>(
    "SELECT cursor::text AS cursor, event_id, conversation_id, project_id, event_type, payload, occurred_at FROM conversation_events WHERE conversation_id = $1 AND project_id = $2 AND cursor > $3::bigint ORDER BY cursor ASC LIMIT 256",
    [conversationId, projectId, after],
  );
  return result.rows.map((row) => ({
    cursor: row.cursor,
    eventId: row.event_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    eventType: row.event_type,
    payload: row.payload,
    occurredAt: new Date(row.occurred_at).toISOString(),
  }));
}

export interface TurnRequestRow {
  turn_ref: string;
  content: string;
}

export interface AssistantTurnRow {
  turn_id: string;
  content: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
  cursor: string;
  created_at: Date;
}

export async function findTurnByRequest(pool: Pool, conversationId: string, requestId: string): Promise<TurnRequestRow | null> {
  const prior = await pool.query<TurnRequestRow>(
    "SELECT turn_ref, content FROM conversation_turns WHERE conversation_id = $1 AND request_id = $2 AND role = 'user'",
    [conversationId, requestId],
  );
  return prior.rowCount !== 0 ? prior.rows[0]! : null;
}

export async function findAssistantTurn(pool: Pool, conversationId: string, turnRef: string): Promise<AssistantTurnRow | null> {
  const assistant = await pool.query<AssistantTurnRow>(
    "SELECT turn_id, content, status, cursor::text AS cursor, created_at FROM conversation_turns WHERE conversation_id = $1 AND turn_ref = $2 AND role = 'assistant'",
    [conversationId, turnRef],
  );
  return assistant.rowCount === 1 ? assistant.rows[0]! : null;
}

export type ClaimConversationTurnResult =
  | { kind: "claimed" }
  | { kind: "replay"; turn: AssistantTurnRow; conversation: ConversationRecord }
  | { kind: "conflict"; reason: "text-mismatch" | "in-progress" | "active-turn" }
  | { kind: "not-found" };

export async function claimConversationTurn(
  pool: Pool,
  args: {
    conversationId: string;
    projectId: string;
    operatorId: string;
    turnId: string;
    requestId: string;
    text: string;
    version: number;
  },
): Promise<ClaimConversationTurnResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [args.conversationId, args.requestId]);
    const lockedPrior = await client.query<TurnRequestRow>(
      "SELECT turn_ref, content FROM conversation_turns WHERE conversation_id = $1 AND request_id = $2 AND role = 'user'",
      [args.conversationId, args.requestId],
    );
    if (lockedPrior.rowCount !== 0) {
      if (lockedPrior.rows[0]!.content !== args.text) {
        await client.query("ROLLBACK");
        client.release();
        return { kind: "conflict", reason: "text-mismatch" };
      }
      const lockedAssistant = await client.query<AssistantTurnRow>(
        "SELECT turn_id, content, status, cursor::text AS cursor, created_at FROM conversation_turns WHERE conversation_id = $1 AND turn_ref = $2 AND role = 'assistant'",
        [args.conversationId, lockedPrior.rows[0]!.turn_ref],
      );
      if (lockedAssistant.rowCount !== 1) {
        await client.query("ROLLBACK");
        client.release();
        return { kind: "conflict", reason: "in-progress" };
      }
      const replay = lockedAssistant.rows[0]!;
      const currentResult = await client.query<ConversationRecord>(
        "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3 FOR UPDATE",
        [args.conversationId, args.projectId, args.operatorId],
      );
      if (currentResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        client.release();
        return { kind: "not-found" };
      }
      const current = currentResult.rows[0]!;
      await client.query("COMMIT");
      client.release();
      return { kind: "replay", turn: replay, conversation: current };
    }
    const claimed = await client.query(
      "UPDATE conversations SET status = 'running', active_turn_id = $3, active_request_id = $4, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND version = $2 AND status NOT IN ('running', 'cancelled', 'unknown')",
      [args.conversationId, args.version, args.turnId, args.requestId],
    );
    if (claimed.rowCount !== 1) {
      await client.query("ROLLBACK");
      client.release();
      return { kind: "conflict", reason: "active-turn" };
    }
    await client.query(
      "INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'user', $6, 'accepted', 0)",
      [randomUUID(), args.turnId, args.requestId, args.conversationId, args.projectId, args.text],
    );
    await appendConversationEvent(client, args.conversationId, args.projectId, "turn_started", { turnId: args.turnId, text: args.text });
    await client.query("COMMIT");
    client.release();
    return { kind: "claimed" };
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
}

export type FinalizeConversationTurnResult =
  | {
      kind: "finalized";
      status: Conversation["status"];
      content: string;
      cursor: string;
      conversation: ConversationRecord;
      wasRunning: boolean;
    }
  | { kind: "not-found" };

export async function finalizeConversationTurn(
  pool: Pool,
  args: {
    conversationId: string;
    projectId: string;
    operatorId: string;
    turnId: string;
    status: Conversation["status"];
    content: string;
  },
): Promise<FinalizeConversationTurnResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<ConversationRecord>(
      "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3 FOR UPDATE",
      [args.conversationId, args.projectId, args.operatorId],
    );
    if (currentResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      client.release();
      return { kind: "not-found" };
    }
    const current = currentResult.rows[0]!;
    let status = args.status;
    let content = args.content;
    if (current.status !== "running") {
      status = current.status === "active" ? status : current.status;
      if (status === "cancelled" || status === "unknown") content = cancellationContent(status);
    }
    const existingTerminal = await client.query<{ cursor: string }>(
      "SELECT cursor::text AS cursor FROM conversation_events WHERE conversation_id = $1 AND project_id = $2 AND event_type IN ('turn_completed', 'turn_failed', 'turn_cancelled', 'turn_unknown') AND payload->>'turnId' = $3 ORDER BY cursor DESC LIMIT 1",
      [args.conversationId, args.projectId, args.turnId],
    );
    const completedCursor =
      existingTerminal.rowCount === 1
        ? existingTerminal.rows[0]!.cursor
        : await appendConversationEvent(client, args.conversationId, args.projectId, terminalEventType(status), {
            status,
            turnId: args.turnId,
            ...(status === "succeeded" ? { content: boundedText(content) } : { message: boundedText(content, 2_000) }),
          });
    await client.query(
      "INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'assistant', $6, $7, $8) ON CONFLICT (turn_id) DO NOTHING",
      [
        args.turnId,
        args.turnId,
        current.active_request_id,
        args.conversationId,
        args.projectId,
        boundedText(content),
        turnStatus(status),
        completedCursor,
      ],
    );
    const wasRunning = current.status === "running";
    if (wasRunning) {
      await client.query(
        "UPDATE conversations SET status = $2, active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status = 'running'",
        [args.conversationId, status],
      );
    }
    await client.query("COMMIT");
    client.release();
    return { kind: "finalized", status, content, cursor: completedCursor, conversation: current, wasRunning };
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
}

export type CancelConversationTurnResult =
  { kind: "echo"; conversation: ConversationRecord } | { kind: "cancelled"; conversation: ConversationRecord } | { kind: "not-found" };

export async function cancelConversationTurn(
  pool: Pool,
  args: {
    conversationId: string;
    projectId: string;
    operatorId: string;
    next: "cancelled" | "unknown";
    message: string;
  },
): Promise<CancelConversationTurnResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<ConversationRecord>(
      "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 AND project_id = $2 AND operator_id = $3 FOR UPDATE",
      [args.conversationId, args.projectId, args.operatorId],
    );
    if (currentResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      client.release();
      return { kind: "not-found" };
    }
    const current = currentResult.rows[0]!;
    if (["succeeded", "failed", "cancelled", "unknown"].includes(current.status)) {
      await client.query("COMMIT");
      client.release();
      return { kind: "echo", conversation: current };
    }
    const turnId = current.active_turn_id;
    const requestId = current.active_request_id ?? randomUUID();
    const cursor = await appendConversationEvent(client, args.conversationId, args.projectId, terminalEventType(args.next), {
      status: args.next,
      ...(turnId === undefined ? {} : { turnId }),
      message: args.message,
    });
    if (turnId !== undefined) {
      await client.query(
        "INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'assistant', $6, $7, $8) ON CONFLICT (turn_id) DO NOTHING",
        [turnId, turnId, requestId, args.conversationId, args.projectId, args.message, turnStatus(args.next), cursor],
      );
    }
    await client.query(
      "UPDATE conversations SET status = $2, active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status IN ('active', 'running')",
      [args.conversationId, args.next],
    );
    await client.query("COMMIT");
    client.release();
    return { kind: "cancelled", conversation: current };
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
}

export async function listActiveConversations(pool: Pool): Promise<ConversationRecord[]> {
  const rows = await pool.query<ConversationRecord>(
    "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE status IN ('active', 'running') ORDER BY created_at ASC",
  );
  return rows.rows;
}

export type FenceInterruptedTurnResult = { kind: "fenced" } | { kind: "skipped" };

export async function fenceInterruptedTurn(pool: Pool, args: { conversationId: string }): Promise<FenceInterruptedTurnResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<ConversationRecord>(
      "SELECT conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, active_turn_id, active_request_id, create_request_id FROM conversations WHERE conversation_id = $1 FOR UPDATE",
      [args.conversationId],
    );
    const current = currentResult.rows[0];
    if (
      current !== undefined &&
      current.active_turn_id !== null &&
      !["succeeded", "failed", "cancelled", "unknown"].includes(current.status)
    ) {
      const turnId = current.active_turn_id;
      const existing = await client.query<{ cursor: string }>(
        "SELECT cursor::text AS cursor FROM conversation_events WHERE conversation_id = $1 AND event_type = 'turn_unknown' AND payload->>'turnId' = $2 ORDER BY cursor DESC LIMIT 1",
        [args.conversationId, turnId],
      );
      const message = cancellationContent("unknown");
      const cursor =
        existing.rowCount === 1
          ? existing.rows[0]!.cursor
          : await appendConversationEvent(client, args.conversationId, current.project_id, "turn_unknown", {
              status: "unknown",
              turnId,
              message,
            });
      await client.query(
        "INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, cursor) VALUES ($1, $2, $3, $4, $5, 'assistant', $6, 'unknown', $7) ON CONFLICT (turn_id) DO NOTHING",
        [turnId, turnId, current.active_request_id ?? randomUUID(), args.conversationId, current.project_id, message, cursor],
      );
      await client.query(
        "UPDATE conversations SET status = 'unknown', active_turn_id = NULL, active_request_id = NULL, version = version + 1, updated_at = transaction_timestamp() WHERE conversation_id = $1 AND status IN ('active', 'running')",
        [args.conversationId],
      );
      await client.query("COMMIT");
      client.release();
      return { kind: "fenced" };
    }
    await client.query("COMMIT");
    client.release();
    return { kind: "skipped" };
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
}
