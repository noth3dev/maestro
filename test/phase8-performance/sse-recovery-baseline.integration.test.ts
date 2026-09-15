import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiClient, type GoalEvent } from "../../packages/api-client/src/index.js";
import { bootstrapLocalOperator } from "../../packages/persistence/src/index.js";
import { grantProjectMembership, grantProjectRole } from "../../packages/persistence/src/testing.js";
import { runMigrations } from "../../packages/persistence/src/migrate.js";
import { createControlPlane } from "../../apps/control-plane/src/main.js";
import { subscribeToEvents } from "../../apps/cli/src/tui/activity-stream.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

describeDatabase("Plan 8 §S5 SSE recovery latency baseline", () => {
  const schema = `phase8_s5_sse_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  const pool = new Pool({ connectionString: scopedUrl });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE reconciler_leader_lease, goal_controls, goal_leases, outbox, goal_events, command_receipts, goals, local_operator_credentials, local_operators CASCADE");
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("records recovery time from a forced disconnect to the resumed durable event", async () => {
    const secret = `phase8-s5-sse-secret-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
      actorId: "phase8-s5-sse-benchmark", leaseOwnerId: `phase8-s5-sse-${randomUUID()}`,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const client = createApiClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: `${credentialId}.${secret}` });
    const recoverySamples: number[] = [];

    try {
      for (let index = 0; index < 10; index += 1) {
        const firstGoalId = randomUUID();
        const secondGoalId = randomUUID();
        for (const goalId of [firstGoalId, secondGoalId]) {
          const response = await fetch(`http://127.0.0.1:${address.port}/v1/goals`, {
            method: "POST",
            headers: { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json", "idempotency-key": goalId },
            body: JSON.stringify({ projectId }),
          });
          expect(response.status).toBe(201);
        }

        let attempt = 0;
        let disconnectedAt = 0;
        let resumedAt = 0;
        const streamClient = {
          streamEvents(query: { projectId: string; after: string }, options: { signal: AbortSignal }): AsyncIterable<GoalEvent> {
            attempt += 1;
            const upstream = client.streamEvents(query, options);
            if (attempt !== 1) return upstream;
            return (async function* () {
              for await (const event of upstream) {
                yield event;
                disconnectedAt = performance.now();
                throw new Error("phase8-s5 forced SSE disconnect");
              }
            })();
          },
        };
        const controller = new AbortController();
        const received: GoalEvent[] = [];
        for await (const event of subscribeToEvents({
          client: streamClient, projectId, signal: controller.signal, cursor: "0", reconnectDelayMs: 0, maxReconnectAttempts: 1,
        })) {
          received.push(event);
          if (received.length === 2) {
            resumedAt = performance.now();
            controller.abort();
          }
        }
        expect(attempt).toBe(2);
        expect(received).toHaveLength(2);
        expect(received[0]?.eventId).not.toBe(received[1]?.eventId);
        expect(disconnectedAt).toBeGreaterThan(0);
        expect(resumedAt).toBeGreaterThanOrEqual(disconnectedAt);
        recoverySamples.push(resumedAt - disconnectedAt);
      }
    } finally {
      await controlPlane.close();
    }

    const baseline = {
      metric: "sse-recovery-latency",
      database: "postgresql",
      sampleCount: recoverySamples.length,
      recoveryMs: { p50: percentile(recoverySamples, 0.5), p95: percentile(recoverySamples, 0.95), max: Math.max(...recoverySamples) },
    };
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
    expect(recoverySamples).toHaveLength(10);
  });
});
