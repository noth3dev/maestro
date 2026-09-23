import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerOvertureRoutes } from "./routes/overture.js";
import { RequestValidationError } from "./server-input.js";
import type { OvertureService } from "./overture-service.js";

const ids = {
  runId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  conversationId: "33333333-3333-4333-8333-333333333333",
  turnId: "44444444-4444-4444-8444-444444444444",
};

const run = {
  runId: ids.runId,
  conversationId: ids.conversationId,
  projectId: ids.projectId,
  goalId: null,
  executionPhase: "overture" as const,
  taskContractRef: null,
  state: "collecting" as const,
  version: 1,
  roleTaxonomyVersion: 2 as const,
  planManifestHash: null,
  taskContractId: null,
  roles: [{ roleId: "conversation-lead" as const, status: "active" as const, modelRef: "openai/gpt-5" }],
};

function service(): OvertureService {
  return {
    createRun: async (input) => {
      expect(input.runId).toBe(ids.runId);
      return run;
    },
    appendOperatorMessage: async (input) => ({
      messageId: "55555555-5555-4555-8555-555555555555",
      runId: input.runId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      turnId: input.turnId,
      cursor: "1",
      actor: "operator" as const,
      modelRef: null,
      content: input.content,
      createdAt: "2026-09-23T00:00:00.000Z",
    }),
    listMessages: async () => [],
    getRun: async () => run,
    listEvents: async () => [],
  };
}

async function app() {
  const fastify = Fastify();
  fastify.addHook("onRequest", async (request) => {
    (request as typeof request & { operator: { operatorId: string } }).operator = { operatorId: "operator-1" };
  });
  fastify.setErrorHandler((error, _request, reply) =>
    reply.status(error instanceof RequestValidationError ? 400 : 500).send({ error: error.message }),
  );
  registerOvertureRoutes(fastify, {
    overture: service(),
    pollingScheduler: {
      setInterval: ((callback: () => void, delay: number) => setInterval(callback, delay)) as unknown as (
        callback: () => void,
        delayMs: number,
      ) => ReturnType<typeof setInterval>,
      clearInterval: (timer) => clearInterval(timer),
    },
    activeStreams: new Set(),
    maxActiveStreams: 4,
  });
  await fastify.ready();
  return fastify;
}

describe("Overture routes", () => {
  it("creates a run with an idempotency key and reads it back", async () => {
    const fastify = await app();
    const response = await fastify.inject({
      method: "POST",
      url: "/v1/overture/runs",
      headers: { "idempotency-key": "66666666-6666-4666-8666-666666666666" },
      payload: { runId: ids.runId, projectId: ids.projectId, conversationId: ids.conversationId, roles: ["conversation-lead"] },
    });
    expect(response.statusCode).toBe(201);
    const read = await fastify.inject({
      method: "GET",
      url: `/v1/overture/runs/${ids.runId}?projectId=${ids.projectId}&conversationId=${ids.conversationId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().executionPhase).toBe("overture");
    await fastify.close();
  });

  it("requires idempotency and preserves operator message identity", async () => {
    const fastify = await app();
    const missing = await fastify.inject({
      method: "POST",
      url: "/v1/overture/runs",
      payload: { runId: ids.runId, projectId: ids.projectId, conversationId: ids.conversationId, roles: ["conversation-lead"] },
    });
    expect(missing.statusCode).toBe(400);
    const message = await fastify.inject({
      method: "POST",
      url: `/v1/overture/runs/${ids.runId}/messages`,
      headers: { "idempotency-key": "77777777-7777-4777-8777-777777777777" },
      payload: {
        projectId: ids.projectId,
        conversationId: ids.conversationId,
        turnId: ids.turnId,
        content: "Please clarify the boundary.",
      },
    });
    expect(message.statusCode).toBe(201);
    expect(message.json().actor).toBe("operator");
    const messages = await fastify.inject({
      method: "GET",
      url: `/v1/overture/runs/${ids.runId}/messages?projectId=${ids.projectId}&conversationId=${ids.conversationId}&afterCursor=0`,
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.json()).toEqual([]);
    await fastify.close();
  });
});
