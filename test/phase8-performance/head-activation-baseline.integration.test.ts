import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionAdmission, ExecutionKernelPort } from "../../packages/domain/src/index.js";
import { bootstrapLocalOperator } from "../../packages/persistence/src/index.js";
import { grantProjectMembership, grantProjectRole } from "../../packages/persistence/src/testing.js";
import { runMigrations } from "../../packages/persistence/src/index.js";
import { createControlPlane } from "../../apps/control-plane/src/main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

function executionKernel(): ExecutionKernelPort {
  let invocation = 0;
  return {
    spawn: async () => {
      invocation += 1;
      return { execution: `head-execution-${invocation}` as never, invocation: `head-invocation-${invocation}` as never };
    },
    prompt: async () => {}, observe: async () => [], sendMessage: async () => {}, cancel: async () => ({ cancelled: false }),
    getModelIdentity: async () => ({ provider: "test", id: "model-a" }),
    getExecutionBinding: async () => ({ model: { provider: "test", id: "model-a" }, accountRef: "head-account", gatewayInstanceId: "head-gateway", gatewayBindingId: "head-binding", dataPolicyHash: "head-policy" }),
    getToolEvents: async () => ({ state: "empty", events: [] }), getUsage: async () => ({ state: "unknown" }),
    getInvocationStatus: async () => "unknown", resume: async () => { throw new Error("not supported"); },
    reconnect: async () => { throw new Error("not supported"); }, release: async () => {},
  };
}

describeDatabase("Plan 8 §S5 Head activation latency baseline", () => {
  const schema = `phase8_s5_head_${randomUUID().replaceAll("-", "")}`;
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

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("records real PostgreSQL and authenticated HTTP Head activation latency", async () => {
    const secret = `phase8-s5-head-secret-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
      actorId: "phase8-s5-head-benchmark", leaseOwnerId: `phase8-s5-head-${randomUUID()}`,
    }, {
      executionKernel: executionKernel(),
      nativeAdmission: (input): ExecutionAdmission => ({
        context: { operatorId, projectId: input.projectId, goalId: input.goalId, missionBundleId: "head-benchmark-bundle", policyVersion: "head-benchmark-policy" },
        grant: { grantId: "head-benchmark-grant", allowedTools: ["read"], allowedSkills: ["head"], modelPolicy: ["test/model-a"], pathScope: ["/tmp"], outboundDataClasses: ["repository files only"], remaining: { modelTurns: 8, toolCalls: 8, childCalls: 0, outputTokens: 8192, wallTimeMs: 60_000, retryCount: 0 } },
        modelPolicy: ["test/model-a"], idempotencyKey: input.commandId,
      }),
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    const samples: number[] = [];

    try {
      const departments = ["product", "design", "engineering", "security", "infrastructure", "research", "data-analysis", "quality", "safety-compliance", "operations"];
      for (let index = 0; index < departments.length; index += 1) {
        const goalId = randomUUID();
        const departmentId = departments[index]!;
        const create = await fetch(`${baseUrl}/v1/goals`, { method: "POST", headers: { ...auth, "idempotency-key": goalId }, body: JSON.stringify({ projectId }) });
        expect(create.status).toBe(201);
        for (const [expectedVersion, to] of [[1, "ready_for_confirmation"], [2, "launched"], [3, "active"]] as const) {
          const transition = await fetch(`${baseUrl}/v1/goals/${goalId}/transitions`, { method: "POST", headers: { ...auth, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, expectedVersion, to }) });
          expect(transition.status).toBe(200);
        }
        const started = performance.now();
        const activation = await fetch(`${baseUrl}/v1/goals/${goalId}/head-participations`, {
          method: "POST", headers: { ...auth, "idempotency-key": randomUUID() },
          body: JSON.stringify({ projectId, departmentId, requestedContribution: "own implementation", urgency: "normal", contextScope: ["confirmed contract"], budgetEffect: "within envelope", reason: "phase 8 performance baseline" }),
        });
        const body = await activation.json() as { status?: string; activeSessionRef?: string };
        samples.push(performance.now() - started);
        expect(activation.status).toBe(200);
        expect(body).toMatchObject({ status: "active", activeSessionRef: `head-execution-${index + 1}` });
      }
    } finally {
      await controlPlane.close();
    }

    const baseline = {
      metric: "head-activation-latency", database: "postgresql", sampleCount: samples.length,
      activationMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) },
    };
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
    expect(samples).toHaveLength(10);
  });
});
