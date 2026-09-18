import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GatewayBinding } from "@maestro/agent-runtime";
import type { Conversation, ConversationEvent } from "@maestro/contracts";

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

export async function appendTurnDelta(
  pool: Pool,
  conversationId: string,
  projectId: string,
  turnId: string,
  text: string,
): Promise<void> {
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
