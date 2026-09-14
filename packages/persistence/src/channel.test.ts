import { expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { getChannel, postChannelMessage } from "./channel.js";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const operatorId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03";
const channelId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04";
const messageId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05";

it("rechecks and locks project authorization inside the message transaction", async () => {
  const calls: string[] = [];
  const messageRow = {
    message_id: messageId,
    message_sequence: "1",
    channel_id: channelId,
    author_kind: "operator",
    author_id: operatorId,
    content: "transactional authorization",
    created_at: new Date("2025-01-01T00:00:00.000Z"),
  };
  const clientQuery = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.includes("FROM operator_project_roles")) return { rowCount: 1, rows: [{ role_id: "head-engineering" }] };
    if (sql.includes("SELECT project_id, state FROM goals")) return { rowCount: 1, rows: [{ project_id: projectId, state: "active" }] };
    if (sql.includes("FROM channels")) return { rowCount: 1, rows: [{ channel_id: channelId, project_id: projectId, goal_id: goalId, scope_kind: "department", scope_id: "engineering", display_name: "#engineering", goal_state: "active" }] };
    if (sql.includes("FROM channel_messages") && sql.includes("idempotency_key")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("INSERT INTO channels")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("INSERT INTO channel_messages")) return { rowCount: 1, rows: [messageRow] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

  await expect(postChannelMessage(pool, {
    operatorId,
    projectId,
    goalId,
    selector: { kind: "department", channelId: "engineering" },
    content: messageRow.content,
    messageId,
  })).resolves.toMatchObject({ messageId, content: messageRow.content });

  const beginIndex = calls.indexOf("BEGIN");
  const authorizationIndex = calls.findIndex((sql) => sql.includes("FROM operator_project_roles"));
  expect(beginIndex).toBeGreaterThanOrEqual(0);
  expect(authorizationIndex).toBeGreaterThan(beginIndex);
  expect(calls[authorizationIndex]).toContain("FOR SHARE");
  expect(pool.connect).toHaveBeenCalledOnce();
});

it("rejects channel reads when project membership lacks the channel role", async () => {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT project_id, state FROM goals")) return { rowCount: 1, rows: [{ project_id: projectId, state: "active" }] };
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (sql: string) => sql.includes("operator_project_roles")
      ? { rowCount: 0, rows: [] }
      : sql.includes("operator_project_memberships")
        ? { rowCount: 1, rows: [{}] }
        : { rowCount: 0, rows: [] }),
    connect: vi.fn(async () => client),
  } as unknown as Pool;

  await expect(getChannel(pool, {
    operatorId, projectId, goalId, selector: { kind: "department", channelId: "engineering" },
  })).rejects.toThrow(/active .* role/);
});
