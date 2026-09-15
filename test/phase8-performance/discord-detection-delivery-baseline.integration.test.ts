import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations, bootstrapLocalOperator } from "@maestro/persistence";
import { createControlPlane } from "../../apps/control-plane/src/main.js";
import type { MaestroConfig } from "../../apps/control-plane/src/config.js";
import { measureDiscordDetectionDelivery } from "./discord-detection-delivery-baseline.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Plan 8 §S5 Discord observation and delivery baseline", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `discord_perf_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let controlPlane: ReturnType<typeof createControlPlane>;
  let operatorCredential: string;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    const secret = `discord-perf-operator-${randomUUID()}`;
    const { credentialId } = await bootstrapLocalOperator(pool, { secret });
    operatorCredential = `${credentialId}.${secret}`;
    const config: MaestroConfig = {
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      worktreeRoot: "/tmp",
      host: "127.0.0.1",
      port: 0,
      actorId: "maestro-control-plane",
      leaseOwnerId: `discord-perf-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
      modelRoutingMode: "ensemble",
      modelGatewayOperatorId: "gateway-operator",
      modelAccountRefs: {},
      discordSignalCredential: "discord-perf-signal-secret",
    };
    controlPlane = createControlPlane(config);
    await controlPlane.listen();
  });

  afterAll(async () => {
    await controlPlane.close();
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("records healthy observation delivery and timer-driven outage recovery", async () => {
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseline = await measureDiscordDetectionDelivery({
      pool,
      baseUrl: `http://127.0.0.1:${address.port}`,
      operatorCredential,
      signalCredential: "discord-perf-signal-secret",
    });
    expect(baseline.sampleCount).toBe(10);
    expect(baseline.detectionMeasured).toBe(false);
    expect(baseline.durable.signalRows).toBe(11);
    expect(baseline.durable.incidentLinks).toBe(11);
    expect(baseline.recovery.timerDriven).toBe(true);
    expect(baseline.recovery.failedAttempts).toBeGreaterThanOrEqual(1);
    expect(baseline.recovery.exactlyOnceAfterRestart).toBe(true);
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
  });
});
