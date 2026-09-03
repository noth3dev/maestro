import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalDevicePolicyAgent } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease, executeGoalCommand } from "./commands.js";
import { enrollDevice, setLocalDevicePolicy } from "./device.js";
import { DeviceGrantAuthorizationError, createDeviceGrant, listDeviceCommandResults, recordDeviceCommandResult } from "./device-grant.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const ceo = { actorId: "ceo", sessionRef: "session:ceo:live-gate", role: "ceo" as const };

describeDatabase("Phase 4 exit gate: a narrow Goal-scoped device grant completes an in-scope task while an out-of-scope action is blocked locally and on the server", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS device_command_results, device_grants, device_policies, devices, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE device_command_results, device_grants, device_policies, devices, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("completes an in-scope read task and blocks an out-of-scope critical action both locally and on the server", async () => {
    const goalId = randomUUID();
    const projectId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const enrolled = await enrollDevice(pool, { displayName: "Enrolled laptop", deviceType: "computer", publicKey: `public-key-${goalId}` }, ceo);

    // The CEO also sets the device's own local policy for this narrow scope
    // -- the same policy the real enrolled device would evaluate itself,
    // before ever contacting the network, per plan/phase4.md step 7
    // ("Device validates identity, Goal, target, expiry, fencing token, and
    // policy locally before execution").
    const withPolicy = await setLocalDevicePolicy(
      pool, enrolled.deviceId,
      { rules: [{ action: "project.file.read", targets: ["/repo/project/README.md"] }], expiresAt: null },
      ceo,
    );
    const { inventory: _inventory, policy: _policy, ...enrollmentOnly } = withPolicy;
    const localAgent = new LocalDevicePolicyAgent(enrollmentOnly, withPolicy.policy);

    // Local, device-side check: the in-scope read is allowed; a critical
    // action is rejected before it ever reaches the network layer.
    expect(localAgent.evaluate({
      deviceId: enrolled.deviceId, identityFingerprint: enrolled.identityFingerprint,
      action: "project.file.read", target: "/repo/project/README.md",
    })).toMatchObject({ allowed: true, reason: "allowed" });
    expect(localAgent.evaluate({
      deviceId: enrolled.deviceId, identityFingerprint: enrolled.identityFingerprint,
      action: "git.push", target: "/repo/project",
    })).toMatchObject({ allowed: false, reason: "critical_action_requires_goal_grant" });

    // The matching Goal-scoped grant and capability the device actually
    // uses to talk to the real control plane.
    const { grant, capabilityToken } = await createDeviceGrant(
      pool, goalId, enrolled.deviceId,
      { actionTypes: ["project.file.read"], projectPaths: ["/repo/project"], applications: ["cli"], dataScope: ["project files"], networkScope: ["none"] },
      new Date(Date.now() + 60_000).toISOString(), proof, ceo,
    );

    const inScope = await recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-1", action: "project.file.read", target: "/repo/project/README.md", sequence: 1, resultSummary: "read the file", executedAt: new Date().toISOString(),
    });
    expect(inScope.action).toBe("project.file.read");

    // Blocked on the server too, in case a compromised or buggy device
    // client ever bypassed its own local check.
    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-2", action: "git.push", target: "/repo/project", sequence: 2, resultSummary: "pushed", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantAuthorizationError);

    expect((await listDeviceCommandResults(pool, grant.grantId)).map((r) => r.action)).toEqual(["project.file.read"]);
  });
});
