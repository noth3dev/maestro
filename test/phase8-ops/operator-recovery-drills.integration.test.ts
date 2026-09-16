import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { bootstrapLocalOperator } from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { applyAllMigrations } from "../../packages/persistence/src/test-migrations.js";
import { executeCli } from "../../apps/cli/src/main.js";
import { createControlPlane } from "../../apps/control-plane/src/main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Plan 8 §S6 emergency-stop app and CLI recovery parity", () => {
  it("returns the same emergency-stopped Goal through the app and CLI", async () => {
    const result = await runEmergencyStopParity(databaseUrl!);

    expect(result.app).toEqual(result.cli);
    expect(result.app).toMatchObject({ state: "stopped", version: 2 });
    expect(result.durable).toMatchObject({ state: "stopped", version: "2", emergencyStopped: true });
  });
});

async function runEmergencyStopParity(databaseUrl: string): Promise<{
  app: unknown;
  cli: unknown;
  durable: unknown;
}> {
  const schema = `phase8_s6_emergency_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: scopedUrl.toString() });
  let controlPlane: ReturnType<typeof createControlPlane> | undefined;

  try {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool);

    const secret = `phase8-s6-secret-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    const goalId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'recovering', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );

    controlPlane = createControlPlane({
      databaseUrl: scopedUrl.toString(),
      evidenceDir: "/tmp/maestro-s6-evidence",
      worktreeRoot: "/tmp",
      host: "127.0.0.1",
      port: 0,
      actorId: "maestro-control-plane",
      leaseOwnerId: `phase8-s6-${randomUUID()}`,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const commandId = randomUUID();
    const headers = {
      authorization: `Bearer ${credentialId}.${secret}`,
      "content-type": "application/json",
      "idempotency-key": commandId,
    };
    const response = await fetch(`${baseUrl}/v1/goals/${goalId}/emergency-stop`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId, expectedVersion: 1 }),
    });
    const app = await response.json();
    expect(response.status).toBe(200);

    const cliOutput: string[] = [];
    const cliCode = await executeCli(
      [
        "goal",
        "emergency-stop",
        "--goal-id",
        goalId,
        "--project-id",
        projectId,
        "--expected-version",
        "1",
        "--command-id",
        commandId,
        "--json",
      ],
      { MAESTRO_API_URL: baseUrl, MAESTRO_API_TOKEN: `${credentialId}.${secret}` },
      { fetch: globalThis.fetch, stdout: (text) => cliOutput.push(text), stderr: () => undefined },
    );
    expect(cliCode).toBe(0);
    const cli = JSON.parse(cliOutput.join(""));
    const durableResult = await pool.query<{ state: string; version: string; emergency_stopped_at: Date | null }>(
      "SELECT goals.state, goals.version, goal_controls.emergency_stopped_at FROM goals JOIN goal_controls USING (goal_id, project_id) WHERE goals.goal_id = $1 AND goals.project_id = $2",
      [goalId, projectId],
    );
    const durable = durableResult.rows[0];
    return {
      app,
      cli,
      durable:
        durable === undefined
          ? undefined
          : { state: durable.state, version: durable.version, emergencyStopped: durable.emergency_stopped_at !== null },
    };
  } finally {
    await controlPlane?.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await basePool.end().catch(() => undefined);
  }
}
