import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { archiveConversation, listConversationSummaries } from "./conversation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Concertmaster session summaries", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `conversation_summary_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  async function conversation(operatorId: string, projectId: string, updatedAt: string, turns: Array<{ role: "user" | "assistant"; content: string; at: string }>) {
    const conversationId = randomUUID();
    await pool.query(
      "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding, created_at, updated_at) VALUES ($1, $2, $3, NULL, 'openai-codex', 'gpt-5.6-sol', 'succeeded', 1, '{}'::jsonb, $4, $4)",
      [conversationId, operatorId, projectId, updatedAt],
    );
    for (const turn of turns) {
      await pool.query(
        "INSERT INTO conversation_turns (turn_id, turn_ref, request_id, conversation_id, project_id, role, content, status, created_at) VALUES ($1, $1, $1, $2, $3, $4, $5, 'completed', $6)",
        [randomUUID(), conversationId, projectId, turn.role, turn.content, turn.at],
      );
    }
    return conversationId;
  }

  it("lists one operator's sessions newest first with the first user message as title", async () => {
    const projectId = randomUUID();
    const older = await conversation("operator-1", projectId, "2026-09-01T00:00:00Z", [
      { role: "user", content: "  Draft the\nrelease plan  ", at: "2026-09-01T00:00:00Z" },
      { role: "assistant", content: "Sure", at: "2026-09-01T00:00:01Z" },
      { role: "user", content: "Second message", at: "2026-09-01T00:00:02Z" },
    ]);
    const newer = await conversation("operator-1", projectId, "2026-09-02T00:00:00Z", [{ role: "user", content: "x".repeat(120), at: "2026-09-02T00:00:00Z" }]);
    const empty = await conversation("operator-1", projectId, "2026-08-01T00:00:00Z", []);
    await conversation("operator-2", projectId, "2026-09-03T00:00:00Z", [{ role: "user", content: "Other operator", at: "2026-09-03T00:00:00Z" }]);
    await conversation("operator-1", randomUUID(), "2026-09-03T00:00:00Z", [{ role: "user", content: "Other project", at: "2026-09-03T00:00:00Z" }]);

    const sessions = await listConversationSummaries(pool, { operatorId: "operator-1", projectId, limit: 10 });

    expect(sessions.map((session) => session.conversationId)).toEqual([newer, older, empty]);
    expect(sessions[1]).toMatchObject({ title: "Draft the release plan", model: "openai-codex/gpt-5.6-sol", goalId: null, status: "succeeded" });
    expect(sessions[0]!.title).toHaveLength(80);
    expect(sessions[0]!.title!.endsWith("…")).toBe(true);
    expect(sessions[2]!.title).toBeNull();
    await expect(listConversationSummaries(pool, { operatorId: "operator-1", projectId, limit: 1 })).resolves.toHaveLength(1);

    // A deleted session leaves the list; only its operator can delete it.
    await expect(archiveConversation(pool, { operatorId: "operator-2", projectId, conversationId: older })).resolves.toBe(false);
    await expect(archiveConversation(pool, { operatorId: "operator-1", projectId, conversationId: older })).resolves.toBe(true);
    expect((await listConversationSummaries(pool, { operatorId: "operator-1", projectId, limit: 10 })).map((session) => session.conversationId)).toEqual([newer, empty]);
  });

  it("lists sessions across every project the operator belongs to when no project is given", async () => {
    const operatorId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1)", [operatorId]);
    const home = randomUUID(), project = randomUUID(), revoked = randomUUID();
    for (const [projectId, active] of [[home, true], [project, true], [revoked, false]] as const)
      await pool.query("INSERT INTO operator_project_memberships (membership_id, operator_id, project_id, active, revoked_at) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), operatorId, projectId, active, active ? null : new Date()]);
    const a = await conversation(operatorId, home, "2026-09-01T00:00:00Z", []);
    const b = await conversation(operatorId, project, "2026-09-02T00:00:00Z", []);
    await conversation(operatorId, revoked, "2026-09-03T00:00:00Z", []);
    const sessions = await listConversationSummaries(pool, { operatorId, limit: 10 });
    expect(sessions.map((session) => [session.conversationId, session.projectId])).toEqual([[b, project], [a, home]]);
  });
});
