import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import { applyAllMigrations } from "@maestro/persistence";
import { createPostgresOvertureService } from "./overture-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Overture clarification role continuation", () => {
  let pool: Pool;
  const operatorId = randomUUID();
  const projectId = randomUUID();
  const conversationId = randomUUID();
  const runId = randomUUID();
  const operator = { operatorId };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyAllMigrations(pool);
    await pool.query(
      "INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT (operator_id) DO NOTHING",
      [operatorId],
    );
    await pool.query(
      "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, $2, $3, NULL, 'anthropic', 'claude-3-5-sonnet', 'active', 1, '{}'::jsonb)",
      [conversationId, operatorId, projectId],
    );
    await pool.query(
      "INSERT INTO operator_project_memberships (membership_id, operator_id, project_id, active) VALUES ($1, $2, $3, true)",
      [randomUUID(), operatorId, projectId],
    );
    await pool.query(
      "INSERT INTO operator_project_roles (grant_id, operator_id, project_id, role_id, active) VALUES ($1, $2, $3, 'concertmaster', true)",
      [randomUUID(), operatorId, projectId],
    );
  });

  afterAll(async () => pool.end());

  it("answers once, creates a real Overture turn, resumes the role, and replays safely", async () => {
    let admissions = 0;
    const gateway = {
      listModels: async () => [],
      admit: async () => {
        admissions += 1;
        return {
          bindingId: `binding-${randomUUID()}`,
          gatewayInstanceId: "gateway-1",
          provider: { provider: "anthropic", id: "claude-3-5-sonnet" },
          account: { providerId: "anthropic", accountRef: "anthropic-test", authMode: "managed-subscription" as const },
          dataPolicyHash: "policy-1",
        };
      },
      turn: async (request) => {
        request.emit({ kind: "text-delta", cursor: 1, text: "Clarification acknowledged." });
        request.emit({ kind: "terminal", cursor: 2, status: "succeeded" });
        return {
          requestId: request.requestId,
          model: { provider: "anthropic", id: "claude-3-5-sonnet" },
          text: "Clarification acknowledged.",
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { state: "unknown" as const },
        };
      },
      cancel: async () => ({ state: "confirmed" as const }),
      recover: async () => "reconnected" as const,
      close: async () => undefined,
    } satisfies ModelGatewayPort;
    const service = createPostgresOvertureService({
      pool,
      gateway,
      gatewayOperatorId: operatorId,
      accountRefs: { anthropic: "anthropic-test" },
      dataPolicyHash: "policy-1",
    });
    await service.createRun({ runId, projectId, conversationId, roles: ["conversation-lead"], commandId: randomUUID() }, operator);
    const clarification = await service.openClarification(
      { runId, projectId, conversationId, question: "Which repository is authoritative?", commandId: randomUUID() },
      operator,
    );
    const commandId = randomUUID();
    const answer = { runId, projectId, conversationId, clarificationId: clarification.clarificationId, answer: "The connected repository", commandId };
    await expect(service.answerClarification(answer, operator)).resolves.toMatchObject({ status: "answered", answer: answer.answer });
    const messages = await service.listMessages(runId, projectId, conversationId, "0", operator);
    expect(messages.map((message) => message.actor)).toEqual(["operator", "conversation-lead"]);
    expect(messages[0]).toMatchObject({ content: answer.answer, turnId: commandId });
    expect(messages[1]).toMatchObject({ content: "Clarification acknowledged.", turnId: commandId });
    expect(admissions).toBe(1);

    await expect(service.answerClarification(answer, operator)).resolves.toMatchObject({ status: "answered" });
    expect((await service.listMessages(runId, projectId, conversationId, "0", operator)).length).toBe(2);
    expect(admissions).toBe(1);
  });
});
