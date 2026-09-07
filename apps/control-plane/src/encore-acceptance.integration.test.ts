import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProviderRegistry, type ModelProviderPort, type ProviderPlugin } from "@maestro/agent-runtime";
import { applyAllMigrations, bootstrapLocalOperator } from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { InMemoryCredentialStore } from "../../model-gateway/src/credential-store.js";
import { createModelGateway } from "../../model-gateway/src/gateway.js";
import { buildModelGatewayServer } from "../../model-gateway/src/rpc.js";
import { createControlPlane } from "./main.js";
import type { MaestroConfig } from "./config.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const GATEWAY_OPERATOR_ID = "gateway-operator";
const PROVIDER_ACCOUNT_REF = "encore-acceptance-account";

function fakeProviderPlugin(): ProviderPlugin {
  const identity = { provider: "test", id: "model-a" };
  const dataPolicy = { allowedDataClasses: ["public"] as const, retention: "none" as const, trainsOnCustomerData: false, regions: ["us"] };
  const port: ModelProviderPort = {
    identity,
    accountRef: PROVIDER_ACCOUNT_REF,
    capabilities: new Set(["text"]),
    async turn(request) {
      const text = JSON.stringify({
        verdict: "proceed",
        confidence: "high",
        reasoning: "the real gateway reviewer agrees this is safe",
        conditions: [],
        dissentNote: null,
        citedEvidenceIds: [],
      });
      return { requestId: request.requestId, model: identity, text, toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
    },
    async cancel() {
      return { state: "confirmed" as const };
    },
    async close() {},
  };
  return {
    id: "test",
    authModes: ["api-key"],
    capabilities: new Set(["text"]),
    dataPolicy,
    listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy }],
    create: async (request) => ({ ...port, accountRef: request.account.accountRef }),
  };
}

describeDatabase("real Encore Council acceptance: multiple real reviewer admissions through one real Model Gateway process", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `encore_acceptance_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl =
    databaseUrl === undefined
      ? ""
      : (() => {
          const url = new URL(databaseUrl);
          url.searchParams.set("options", `-c search_path=${schema}`);
          return url.toString();
        })();
  let pool: Pool;
  let gatewayApp: Awaited<ReturnType<typeof buildModelGatewayServer>>;
  let gatewayUrl: string;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    const credentials = new InMemoryCredentialStore();
    await credentials.bind(
      { operatorId: GATEWAY_OPERATOR_ID, providerId: "test", authMode: "api-key", accountRef: PROVIDER_ACCOUNT_REF },
      "provider-secret-not-real",
    );
    const registry = new ProviderRegistry();
    registry.register(fakeProviderPlugin());
    const gateway = createModelGateway({ registry, credentials, operatorId: GATEWAY_OPERATOR_ID, instanceId: "encore-acceptance-gateway" });
    gatewayApp = buildModelGatewayServer({ gateway, token: "gateway-acceptance-token", operatorId: GATEWAY_OPERATOR_ID });
    await gatewayApp.listen({ host: "127.0.0.1", port: 0 });
    const address = gatewayApp.server.address();
    if (address === null || typeof address === "string") throw new Error("Model Gateway did not bind TCP");
    gatewayUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE native_execution_bindings, encore_council_syntheses, encore_council_judgments, encore_council_rounds, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, local_operator_credentials, local_operators CASCADE",
    );
  });
  afterAll(async () => {
    await gatewayApp.close();
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("admits two real reviewers through the real gateway, records durable binding evidence for each, and honestly reports a same-model round", async () => {
    const secret = `encore-acceptance-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    const goalId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    const evidenceId = randomUUID();

    const config: MaestroConfig = {
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      worktreeRoot: "/tmp",
      host: "127.0.0.1",
      port: 0,
      actorId: "maestro-control-plane",
      leaseOwnerId: `encore-acceptance-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
      modelGatewayUrl: gatewayUrl,
      modelGatewayToken: "gateway-acceptance-token",
      modelGatewayOperatorId: GATEWAY_OPERATOR_ID,
      nativeModelRef: "test/model-a",
      modelAccountRefs: { test: PROVIDER_ACCOUNT_REF },
    };
    const controlPlane = createControlPlane(config);
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    const send = (path: string, body: unknown, command = randomUUID()) =>
      fetch(new URL(path, baseUrl), { method: "POST", headers: { ...auth, "idempotency-key": command }, body: JSON.stringify(body) });
    try {
      // Drive the Goal through its real lifecycle after the Control Plane is
      // listening (and reconcileOnStartup has already run), rather than
      // inserting a raw 'active' row directly -- a Goal reconciliation
      // cannot verify against real lease/event history looks exactly like
      // one a crashed process left inconsistent, and reconcileOnStartup
      // correctly, defensively marks it "recovering" rather than trusting
      // an unverifiable state column.
      const created = await send("/v1/goals", { projectId }, goalId);
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ goalId, projectId, state: "draft", version: 1 });
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, 'encore-acceptance-test', $6, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "0".repeat(64)],
      );
      for (const [expectedVersion, to] of [
        [1, "ready_for_confirmation"],
        [2, "launched"],
        [3, "active"],
      ] as const) {
        expect((await send(`/v1/goals/${goalId}/transitions`, { projectId, expectedVersion, to })).status).toBe(200);
      }
      const response = await fetch(new URL(`v1/goals/${goalId}/encore/reviews`, baseUrl), {
        method: "POST",
        headers: { ...auth, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          projectId,
          question: "should the team proceed?",
          criteria: [{ criterionId: "safety", description: "does this preserve safety invariants" }],
          evidenceIds: [evidenceId],
          reviewerCount: 2,
        }),
      });
      expect(response.status).toBe(201);
      const result = (await response.json()) as {
        synthesis: { finalVerdict: string; sameModelOnly: boolean; escalated: boolean };
        judgments: { modelProvider: string; modelId: string }[];
      };
      expect(result.judgments).toHaveLength(2);
      expect(result.judgments.every((judgment) => judgment.modelProvider === "test" && judgment.modelId === "model-a")).toBe(true);
      // Only one real model is configured, so a genuinely honest round must
      // say so rather than silently claiming multi-model diversity.
      expect(result.synthesis).toMatchObject({ finalVerdict: "proceed", sameModelOnly: true, escalated: false });

      const bindings = await pool.query<{
        selected_model_provider: string;
        selected_model_id: string;
        actual_model_provider: string;
        actual_model_id: string;
        account_ref: string;
      }>(
        "SELECT selected_model_provider, selected_model_id, actual_model_provider, actual_model_id, account_ref FROM native_execution_bindings WHERE admission_kind = 'encore_reviewer' ORDER BY created_at",
      );
      expect(bindings.rows).toHaveLength(2);
      expect(
        bindings.rows.every(
          (row) =>
            row.selected_model_provider === "test" &&
            row.selected_model_id === "model-a" &&
            row.actual_model_provider === "test" &&
            row.actual_model_id === "model-a" &&
            row.account_ref === PROVIDER_ACCOUNT_REF,
        ),
      ).toBe(true);
      expect(JSON.stringify(bindings.rows)).not.toContain("provider-secret-not-real");
    } finally {
      await controlPlane.close();
    }
  });
});
