import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations, assertProjectMembership, bootstrapLocalOperator, bootstrapPermanentOrganization, getChannel, postChannelMessage } from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { buildServer, type GoalService, type OperatorAuthenticator } from "./server.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const goalService = {} as GoalService;

describeDatabase("channel route durability", () => {
  const schema = `channel_route_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    const scopedUrl = new URL(databaseUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: scopedUrl.toString() });
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("posts through HTTP, closes, and reads the durable message after server reload", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const operatorSecret = `channel-route-${randomUUID()}`;
    const { operatorId, credentialId } = await bootstrapLocalOperator(pool, { secret: operatorSecret });
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const authenticator: OperatorAuthenticator = {
      authenticateBearerSecret: async (secret) => secret === `${credentialId}.${operatorSecret}`
        ? { outcome: "authenticated", operator: { operatorId, credentialId } }
        : { outcome: "invalid" },
    };
    const service = {
      get: (input: Parameters<typeof getChannel>[1]) => getChannel(pool, input),
      post: (input: Parameters<typeof postChannelMessage>[1]) => postChannelMessage(pool, input),
    };
    const createApp = () => buildServer({
      goalService,
      authenticator,
      channelService: service,
      projectMembership: { assertProjectMembership: (id, project) => assertProjectMembership(pool, id, project) },
    });
    const url = `/v1/goals/${goalId}/channels/department/engineering`;
    const headers = { authorization: `Bearer ${credentialId}.${operatorSecret}`, "content-type": "application/json" };
    const app = createApp();
    const posted = await app.inject({ method: "POST", url: `${url}/messages`, headers: { ...headers, "idempotency-key": randomUUID() }, payload: { projectId, content: "persisted through the route" } });
    expect(posted.statusCode).toBe(201);
    await app.close();

    const reloaded = createApp();
    try {
      const read = await reloaded.inject({ method: "GET", url: `${url}?projectId=${projectId}`, headers });
      expect(read.statusCode).toBe(200);
      expect(read.json().messages.map((message: { content: string }) => message.content)).toEqual(["persisted through the route"]);
    } finally { await reloaded.close(); }
  });
});
