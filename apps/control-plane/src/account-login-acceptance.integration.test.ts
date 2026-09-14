import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CodexAppServerClient, type CodexAppServerTransport } from "@maestro/model-provider-openai";
import { applyAllMigrations, bootstrapLocalOperator } from "@maestro/persistence";
import { InMemoryCredentialStore } from "../../model-gateway/src/credential-store.js";
import { ProviderRegistry, type ModelProviderPort, type ProviderPlugin } from "@maestro/agent-runtime";
import { createModelGateway } from "../../model-gateway/src/gateway.js";
import { buildModelGatewayServer } from "../../model-gateway/src/rpc.js";
import { createControlPlane } from "./main.js";
import type { MaestroConfig } from "./config.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const GATEWAY_OPERATOR_ID = "gateway-operator";

/** The same fake transport shape as codex-app-server.test.ts's FakeTransport,
 * duplicated locally so this acceptance test owns its own login-completion
 * trigger without importing test-only fixtures across package boundaries. */
function fakeOpenAiPlugin(): ProviderPlugin {
  const identity = { provider: "openai" as const, id: "model-a" };
  const dataPolicy = { allowedDataClasses: ["public"] as const, retention: "none" as const, trainsOnCustomerData: false, regions: ["us"] };
  const port: ModelProviderPort = {
    identity, accountRef: "account-1", capabilities: new Set(["text"]),
    async turn(request) { return { requestId: request.requestId, model: identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } }; },
    async cancel() { return { state: "confirmed" as const }; },
    async close() {},
  };
  return { id: "openai", authModes: ["api-key"], capabilities: new Set(["text"]), dataPolicy, listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy }], create: async (request) => ({ ...port, accountRef: request.account.accountRef }) };
}

class FakeCodexTransport implements CodexAppServerTransport {
  private listener?: (message: unknown) => void;
  onMessage(listener: (message: unknown) => void): () => void { this.listener = listener; return () => { this.listener = undefined; }; }
  send(message: unknown): void {
    const request = message as { id?: number; method?: string };
    if (request.method === "initialize") queueMicrotask(() => this.listener?.({ id: request.id, result: {} }));
    if (request.method === "account/login/start") queueMicrotask(() => this.listener?.({ id: request.id, result: { type: "chatgpt", loginId: "provider-login-1", authUrl: "https://chatgpt.com/oauth?state=opaque" } }));
  }
  notify(message: unknown): void { this.listener?.(message); }
  async close(): Promise<void> {}
}

describeDatabase("real account-login acceptance: authenticated HTTP + real Model Gateway + real PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `account_login_acceptance_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let gatewayApp: Awaited<ReturnType<typeof buildModelGatewayServer>>;
  let gatewayUrl: string;
  let transport: FakeCodexTransport;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    const credentials = new InMemoryCredentialStore();
    transport = new FakeCodexTransport();
    const codex = new CodexAppServerClient({ transport, clientInfo: { name: "maestro", title: "Maestro", version: "test" } });
    const registry = new ProviderRegistry();
    registry.register(fakeOpenAiPlugin());
    const gateway = createModelGateway({ registry, credentials, operatorId: GATEWAY_OPERATOR_ID, instanceId: "acceptance-gateway", codex });
    gatewayApp = buildModelGatewayServer({ gateway, token: "gateway-acceptance-token", operatorId: GATEWAY_OPERATOR_ID });
    await gatewayApp.listen({ host: "127.0.0.1", port: 0 });
    const address = gatewayApp.server.address();
    if (address === null || typeof address === "string") throw new Error("Model Gateway did not bind TCP");
    gatewayUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE provider_account_login_sessions, local_operator_credentials, local_operators CASCADE");
  });
  afterAll(async () => {
    await gatewayApp.close();
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("starts a real ChatGPT login, completes it, and never leaks a token through durable state or HTTP responses", async () => {
    const secret = `account-login-acceptance-${randomUUID()}`;
    const { credentialId } = await bootstrapLocalOperator(pool, { secret });

    const config: MaestroConfig = {
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp",
      host: "127.0.0.1", port: 0, actorId: "maestro-control-plane", leaseOwnerId: `account-login-acceptance-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
      modelRoutingMode: "ensemble",
      modelGatewayUrl: gatewayUrl, modelGatewayToken: "gateway-acceptance-token", modelGatewayOperatorId: GATEWAY_OPERATOR_ID,
      modelAccountRefs: {},
    };
    const controlPlane = createControlPlane(config);
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    const send = (path: string, body: unknown, command = randomUUID()) =>
      fetch(`${baseUrl}${path}`, { method: "POST", headers: { ...auth, "idempotency-key": command }, body: JSON.stringify(body) });
    try {
      const started = await send("/v1/provider-account-logins/start", { providerId: "openai-codex" });
      expect(started.status).toBe(200);
      const startedBody = await started.json() as { providerId: string; loginId: string; authUrl: string };
      expect(startedBody).toMatchObject({ providerId: "openai-codex", authUrl: "https://chatgpt.com/oauth?state=opaque" });
      // The client-facing loginId is Maestro's own durable identity, never
      // the raw provider session id the fake transport assigned above.
      expect(startedBody.loginId).not.toBe("provider-login-1");

      const firstStatus = await send("/v1/provider-account-logins/status", { providerId: "openai-codex", loginId: startedBody.loginId });
      expect(firstStatus.status).toBe(200);
      const firstStatusBody = await firstStatus.json();
      expect(firstStatusBody).toEqual({ providerId: "openai-codex", loginId: startedBody.loginId, state: "pending" });

      const pendingRow = await pool.query<{ state: string; provider_login_id: string; auth_url: string }>(
        "SELECT state, provider_login_id, auth_url FROM provider_account_login_sessions WHERE login_id = $1", [startedBody.loginId],
      );
      expect(pendingRow.rows).toEqual([{ state: "pending", provider_login_id: "provider-login-1", auth_url: "https://chatgpt.com/oauth?state=opaque" }]);

      // Simulate the real browser OAuth completion the user would perform
      // out-of-band; the Codex app-server (or here, its wire-compatible fake)
      // reports it as a notification, never as returned token material.
      transport.notify({ method: "account/login/completed", params: { loginId: "provider-login-1", success: true, error: null } });

      const succeededStatus = await send("/v1/provider-account-logins/status", { providerId: "openai-codex", loginId: startedBody.loginId });
      expect(succeededStatus.status).toBe(200);
      expect(await succeededStatus.json()).toEqual({ providerId: "openai-codex", loginId: startedBody.loginId, state: "succeeded" });

      const succeededRow = await pool.query<{ state: string }>("SELECT state FROM provider_account_login_sessions WHERE login_id = $1", [startedBody.loginId]);
      expect(succeededRow.rows).toEqual([{ state: "succeeded" }]);

      const bindingRow = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'provider_account_login_sessions'");
      const columns = bindingRow.rows.map((row) => (row as { column_name: string }).column_name);
      expect(columns).not.toContain("secret");
      expect(columns).not.toContain("token");

      const responseBodies = JSON.stringify([startedBody, firstStatusBody]);
      expect(responseBodies).not.toContain("access_token");
      expect(responseBodies).not.toContain("refresh_token");

      // Same real gateway process, same operatorId-equality boundary as the
      // account-login calls above: proves the fix is not narrowly scoped to
      // account-login alone.
      const bound = await send("/v1/provider-credentials", { providerId: "openai", authMode: "api-key", secret: "sk-real-not-logged" });
      expect(bound.status).toBe(200);
      const boundBody = await bound.json() as { providerId: string; accountRef: string };
      expect(boundBody.providerId).toBe("openai");
      expect(JSON.stringify(boundBody)).not.toContain("sk-real-not-logged");
    } finally {
      await controlPlane.close();
    }
  });
});
