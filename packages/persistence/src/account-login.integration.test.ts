import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { createPostgresAccountLoginStore } from "./account-login.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("durable provider account login sessions", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `account_login_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE provider_account_login_sessions"); });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("returns the same durable login identity for a repeated operator request", async () => {
    const store = createPostgresAccountLoginStore(pool);
    const first = await store.reserveStart("operator-1", "request-1", "openai-codex", "control-plane-1");
    const second = await store.reserveStart("operator-1", "request-1", "openai-codex", "control-plane-1");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.loginId).toBe(first.record.loginId);
    const pending = await store.completeStart(first.record.loginId, "provider-login-1", "https://chatgpt.com/login?state=opaque");
    expect(pending).toMatchObject({ loginId: first.record.loginId, providerLoginId: "provider-login-1", authUrl: "https://chatgpt.com/login?state=opaque", state: "pending" });
    const read = await store.get(first.record.loginId, "operator-1");
    expect(read).toEqual(pending);
  });

  it("fences a login left in starting state by a previous control-plane process", async () => {
    const store = createPostgresAccountLoginStore(pool);
    const reserved = await store.reserveStart("operator-1", "request-restart", "openai-codex", "control-plane-old");
    expect(reserved.record.state).toBe("starting");
    await expect(store.recoverStarting("control-plane-new")).resolves.toBe(1);
    await expect(store.get(reserved.record.loginId, "operator-1")).resolves.toMatchObject({ state: "unknown", message: "Provider login was interrupted during Control Plane restart", providerLoginId: null, authUrl: null });
  });

  it("serializes status and cancel operations with a reclaimable lease", async () => {
    const store = createPostgresAccountLoginStore(pool);
    const reserved = await store.reserveStart("operator-1", "request-operation", "openai-codex", "control-plane-1");
    await store.completeStart(reserved.record.loginId, "provider-login-operation", "https://chatgpt.com/login?state=opaque");
    const claims = await Promise.all([
      store.claimOperation(reserved.record.loginId, "operator-1", "status", "control-plane-1", 30_000),
      store.claimOperation(reserved.record.loginId, "operator-1", "cancel", "control-plane-2", 30_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims[0] ?? claims[1];
    expect(winner).toEqual(expect.any(String));
    await store.releaseOperation(reserved.record.loginId, "operator-1", "control-plane-1", winner!);
    await expect(store.claimOperation(reserved.record.loginId, "operator-1", "status", "control-plane-3", 30_000)).resolves.toEqual(expect.any(String));
  });

  it("does not let a late stale operation overwrite a reclaimed lease", async () => {
    const store = createPostgresAccountLoginStore(pool);
    const reserved = await store.reserveStart("operator-1", "request-stale-operation", "openai-codex", "control-plane-1");
    await store.completeStart(reserved.record.loginId, "provider-login-stale", "https://chatgpt.com/login?state=opaque");
    const tokenA = await store.claimOperation(reserved.record.loginId, "operator-1", "status", "control-plane-1", 30_000);
    expect(tokenA).toEqual(expect.any(String));
    await pool.query("UPDATE provider_account_login_sessions SET operation_started_at = transaction_timestamp() - interval '1 minute' WHERE login_id = $1", [reserved.record.loginId]);
    const tokenB = await store.claimOperation(reserved.record.loginId, "operator-1", "cancel", "control-plane-1", 30_000);
    expect(tokenB).toEqual(expect.any(String));
    expect(tokenB).not.toBe(tokenA);
    await expect(store.updateState(reserved.record.loginId, "operator-1", "succeeded", undefined, "control-plane-1", tokenA)).resolves.toMatchObject({ state: "pending" });
    await store.releaseOperation(reserved.record.loginId, "operator-1", "control-plane-1", tokenA!);
    await expect(store.get(reserved.record.loginId, "operator-1")).resolves.toMatchObject({ state: "pending" });
    await expect(store.updateState(reserved.record.loginId, "operator-1", "cancelled", undefined, "control-plane-1", tokenB!)).resolves.toMatchObject({ state: "cancelled" });
  });

  it("keeps login identity append-only and rejects deletion", async () => {
    const store = createPostgresAccountLoginStore(pool);
    const reserved = await store.reserveStart("operator-1", "request-identity", "openai-codex", "control-plane-1");
    await expect(pool.query("UPDATE provider_account_login_sessions SET request_id = 'rewritten' WHERE login_id = $1", [reserved.record.loginId])).rejects.toThrow("identity is immutable");
    await expect(pool.query("DELETE FROM provider_account_login_sessions WHERE login_id = $1", [reserved.record.loginId])).rejects.toThrow("append-only");
    await store.completeStart(reserved.record.loginId, "provider-login-identity", "https://chatgpt.com/login?state=opaque");
    await expect(pool.query("UPDATE provider_account_login_sessions SET provider_login_id = 'rewritten-provider' WHERE login_id = $1", [reserved.record.loginId])).rejects.toThrow("identity is immutable");
    await expect(store.reserveStart("operator-1", "request-identity", "openai-codex", "control-plane-2")).resolves.toMatchObject({ created: false, record: { loginId: reserved.record.loginId, state: "pending" } });
  });

  it("records a lost gateway session as terminal unknown and prevents resurrection", async () => {
    const store = createPostgresAccountLoginStore(pool);
    const reserved = await store.reserveStart("operator-1", "request-2", "openai-codex", "control-plane-1");
    await store.completeStart(reserved.record.loginId, "provider-login-2", "https://auth.openai.com/login");
    const unknown = await store.updateState(reserved.record.loginId, "operator-1", "unknown", "Gateway login session was lost during restart");
    expect(unknown.state).toBe("unknown");
    await expect(store.updateState(reserved.record.loginId, "operator-1", "pending")).resolves.toMatchObject({ state: "unknown" });
    await expect(pool.query("UPDATE provider_account_login_sessions SET state = 'pending' WHERE login_id = $1", [reserved.record.loginId])).rejects.toThrow(/terminal/);
  });
});
