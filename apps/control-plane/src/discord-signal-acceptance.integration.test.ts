import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveDiscordIncidentFingerprint, signDiscordSignal, type DiscordSignal } from "@maestro/domain";
import { applyAllMigrations, bootstrapLocalOperator } from "@maestro/persistence";
import { createControlPlane } from "./main.js";
import type { MaestroConfig } from "./config.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const DISCORD_SIGNAL_SECRET = "discord-acceptance-secret";

function signal(): DiscordSignal {
  // Real freshness verification (packages/domain/src/discord.ts's
  // assertFreshAtReceipt) checks these timestamps against the real wall
  // clock by default, so this fixture must use real "now"-relative times,
  // not a hardcoded historical date.
  const now = Date.now();
  const value: DiscordSignal = {
    incidentFingerprint: "",
    firstObservedAt: new Date(now - 2000).toISOString(),
    lastObservedAt: new Date(now - 1000).toISOString(),
    severity: "critical",
    confidence: 0.9,
    affectedComponent: "control-plane-health-endpoint",
    affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "health-probe",
    sourceFreshness: new Date(now - 1000).toISOString(),
    deduplicationRelationship: "new",
    discordHealthState: "healthy",
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
}

describeDatabase("real Discord signal delivery: authenticated operator HTTP + real HMAC signature + real PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `discord_acceptance_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE discord_signals, local_operator_credentials, local_operators CASCADE");
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("accepts a real HTTP delivery matching createHttpDelivery's exact request shape, verifies the embedded HMAC signature, and records it durably", async () => {
    const secret = `discord-acceptance-${randomUUID()}`;
    const { credentialId } = await bootstrapLocalOperator(pool, { secret });

    const config: MaestroConfig = {
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp",
      host: "127.0.0.1", port: 0, actorId: "maestro-control-plane", leaseOwnerId: `discord-acceptance-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
      modelGatewayOperatorId: "gateway-operator", modelAccountRefs: {},
      discordSignalCredential: DISCORD_SIGNAL_SECRET,
    };
    const controlPlane = createControlPlane(config);
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Mirrors apps/discord/src/main.ts's createHttpDelivery exactly: a
    // Bearer operator credential for the HTTP route itself, plus the
    // signal's own embedded HMAC signature the watchdog process computed
    // out-of-band with a separately configured shared secret.
    const envelope = signDiscordSignal(signal(), DISCORD_SIGNAL_SECRET, randomUUID(), 1);
    try {
      const delivered = await fetch(new URL("v1/discord/signals", baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
      expect(delivered.status).toBe(201);
      const deliveredBody = await delivered.json() as { signalId: string; incidentId: string | null };
      expect(deliveredBody.signalId).toMatch(/^[0-9a-f-]{36}$/);

      const row = await pool.query<{ nonce: string; sequence: number }>("SELECT nonce, sequence::int FROM discord_signals WHERE signal_id = $1", [deliveredBody.signalId]);
      expect(row.rows).toEqual([{ nonce: envelope.nonce, sequence: 1 }]);

      // A tampered signature over the exact same real HTTP + operator-auth
      // boundary must still fail closed.
      const tampered = { ...envelope, signal: { ...envelope.signal, severity: "warning" as const } };
      const rejected = await fetch(new URL("v1/discord/signals", baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" },
        body: JSON.stringify(tampered),
      });
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await rejected.json())).not.toContain(DISCORD_SIGNAL_SECRET);
    } finally {
      await controlPlane.close();
    }
  });
});
