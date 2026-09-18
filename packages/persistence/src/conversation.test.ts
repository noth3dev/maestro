import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  appendConversationEvent,
  appendTurnDelta,
  listConversationEvents,
  markConversationUnknown,
  readConversationRecord,
} from "./conversation.js";

const row = {
  conversation_id: "conversation-1",
  operator_id: "operator-1",
  project_id: "project-1",
  goal_id: null,
  model_provider: "openai",
  model_id: "gpt-5",
  status: "active",
  version: 1,
  binding: {},
  active_turn_id: null,
  active_request_id: null,
  create_request_id: null,
};

function fakeClient(respond?: (text: string) => { rows?: unknown[]; rowCount?: number }) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  return {
    calls,
    release: vi.fn(),
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      const next = respond?.(text) ?? { rows: [], rowCount: 0 };
      return { rows: next.rows ?? [], rowCount: next.rowCount ?? 0 };
    }),
  };
}

function fakePool(client: ReturnType<typeof fakeClient>, queryResult: { rows?: unknown[]; rowCount?: number } = { rows: [], rowCount: 0 }) {
  return {
    query: vi.fn(async () => ({ rows: queryResult.rows ?? [], rowCount: queryResult.rowCount ?? 0 })),
    connect: vi.fn(async () => client),
  } as unknown as Pool;
}

describe("conversation store reads", () => {
  it("reads a single conversation row and reports absence as null", async () => {
    const client = fakeClient();
    const pool = fakePool(client, { rows: [row], rowCount: 1 });
    const found = await readConversationRecord(pool, "conversation-1", "project-1", "operator-1");
    expect(found).toEqual(row);
    const missingPool = fakePool(fakeClient(), { rows: [], rowCount: 0 });
    expect(await readConversationRecord(missingPool, "missing", "project-1", "operator-1")).toBeNull();
  });

  it("appends events and returns the cursor", async () => {
    const client = fakeClient((text) => (text.startsWith("INSERT") ? { rows: [{ cursor: "7" }], rowCount: 1 } : {}));
    const cursor = await appendConversationEvent(client, "conversation-1", "project-1", "turn_started", { turnId: "turn-1" });
    expect(cursor).toBe("7");
    expect(client.calls[0]!.text).toContain("INSERT INTO conversation_events");
    expect(JSON.parse(client.calls[0]!.values![4] as string)).toEqual({ turnId: "turn-1" });
  });

  it("appends turn deltas as ordered events", async () => {
    const client = fakeClient();
    const pool = fakePool(client);
    await appendTurnDelta(pool, "conversation-1", "project-1", "turn-1", "hello");
    const poolCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(poolCalls.length).toBe(1);
    expect(poolCalls[0]![0]).toContain("'turn_delta'");
    expect(JSON.parse(poolCalls[0]![1][3] as string)).toEqual({ turnId: "turn-1", text: "hello" });
  });

  it("lists events with cursor-ordered mapping", async () => {
    const eventRow = {
      cursor: "9",
      event_id: "event-1",
      conversation_id: "conversation-1",
      project_id: "project-1",
      event_type: "turn_started",
      payload: { turnId: "turn-1" },
      occurred_at: "2026-09-18T00:00:00.000Z",
    };
    const pool = fakePool(fakeClient(), { rows: [eventRow], rowCount: 1 });
    const events = await listConversationEvents(pool, "conversation-1", "project-1", "0");
    expect(events).toEqual([
      {
        cursor: "9",
        eventId: "event-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        eventType: "turn_started",
        payload: { turnId: "turn-1" },
        occurredAt: "2026-09-18T00:00:00.000Z",
      },
    ]);
  });
});

describe("markConversationUnknown", () => {
  it("writes the unknown marker exactly once in BEGIN/COMMIT order", async () => {
    const active = { ...row, status: "running" };
    const client = fakeClient((text) => {
      if (text.includes("FROM conversations")) return { rows: [active], rowCount: 1 };
      if (text.includes("RETURNING")) return { rows: [{ cursor: "3" }], rowCount: 1 };
      return {};
    });
    const pool = fakePool(client);
    await markConversationUnknown(pool, "conversation-1", "project-1", "reason-1", "message-1");
    const texts = client.calls.map((call) => call.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts[1]).toContain("FOR UPDATE");
    expect(texts[2]).toContain("turn_unknown");
    expect(texts[3]).toContain("INSERT INTO conversation_events");
    expect(texts[4]).toContain("SET status = 'unknown'");
    expect(texts[texts.length - 1]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("commits without writing when already terminal", async () => {
    const terminal = { ...row, status: "cancelled" };
    const client = fakeClient((text) => (text.includes("FROM conversations") ? { rows: [terminal], rowCount: 1 } : {}));
    const pool = fakePool(client);
    await markConversationUnknown(pool, "conversation-1", "project-1", "reason-1", "message-1");
    const texts = client.calls.map((call) => call.text);
    expect(texts).toContain("BEGIN");
    expect(texts).toContain("COMMIT");
    expect(texts.some((text) => text.startsWith("INSERT"))).toBe(false);
    expect(texts.some((text) => text.startsWith("UPDATE"))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
