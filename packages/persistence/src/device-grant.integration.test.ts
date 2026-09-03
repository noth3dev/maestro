import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeviceGrantScope } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { enrollDevice, revokeDevice } from "./device.js";
import {
  DeviceGrantAuthorizationError,
  DeviceGrantError,
  DeviceGrantExpiredError,
  DeviceGrantNotFoundError,
  DeviceGrantRevokedError,
  createDeviceGrant,
  listDeviceCommandResults,
  listDeviceGrantsForGoal,
  readDeviceGrant,
  recordDeviceCommandResult,
  revokeDeviceGrant,
} from "./device-grant.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const ceo = (goalId: string) => ({ actorId: "ceo", sessionRef: `session:ceo:${goalId}` });

const scope = (overrides: Partial<DeviceGrantScope> = {}): DeviceGrantScope => ({
  actionTypes: ["project.file.read"],
  projectPaths: ["/repo/project"],
  applications: ["chromium"],
  dataScope: ["project files"],
  networkScope: ["none"],
  ...overrides,
});

describeDatabase("Device grants and command results with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupGoalAndDevice() {
    const goalId = randomUUID();
    const projectId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: `public-key-${goalId}` }, { actorId: "ceo", sessionRef: "session:ceo:enroll", role: "ceo" as const });
    return { goalId, proof, deviceId: device.deviceId };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS device_command_results, device_grants, device_policies, devices, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE device_command_results, device_grants, device_policies, devices, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("issues a Goal-scoped grant with a one-time capability token and records durable scope", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    expect(grant).toMatchObject({ goalId, deviceId, state: "active", ceoApproved: false, scope: scope() });
    expect(capabilityToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await readDeviceGrant(pool, grant.grantId))?.grantId).toBe(grant.grantId);
    expect((await listDeviceGrantsForGoal(pool, goalId)).map((g) => g.grantId)).toEqual([grant.grantId]);
  });

  it("rejects a critical-action scope without explicit CEO approval, and accepts it with approval", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const criticalScope = scope({ actionTypes: ["git.push"] });
    await expect(createDeviceGrant(pool, goalId, deviceId, criticalScope, new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId))).rejects.toBeInstanceOf(DeviceGrantAuthorizationError);
    const { grant } = await createDeviceGrant(pool, goalId, deviceId, criticalScope, new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId), true);
    expect(grant.ceoApproved).toBe(true);
  });

  it("rejects a grant for a revoked device", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    await revokeDevice(pool, deviceId, { actorId: "ceo", sessionRef: "session:ceo:revoke", role: "ceo" as const });
    await expect(createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId))).rejects.toBeInstanceOf(DeviceGrantRevokedError);
  });

  it("records a sequenced command result inside scope and rejects one outside scope", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    const recorded = await recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-1", action: "project.file.read", target: "/repo/project/README.md", sequence: 1, resultSummary: "read ok", executedAt: new Date().toISOString(),
    });
    expect(recorded).toMatchObject({ grantId: grant.grantId, sequence: 1 });
    expect((await listDeviceCommandResults(pool, grant.grantId)).map((r) => r.sequence)).toEqual([1]);

    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-2", action: "git.push", target: "/repo/project", sequence: 2, resultSummary: "pushed", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantAuthorizationError);

    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-3", action: "project.file.read", target: "/etc/passwd", sequence: 2, resultSummary: "read", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantAuthorizationError);
  });

  it("rejects a wrong capability token", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    await expect(recordDeviceCommandResult(pool, grant.grantId, "0".repeat(64), {
      commandId: "command-1", action: "project.file.read", target: "/repo/project/README.md", sequence: 1, resultSummary: "read", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantAuthorizationError);
  });

  it("fences a stale sequence after a successor result already committed", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    await recordDeviceCommandResult(pool, grant.grantId, capabilityToken, { commandId: "c1", action: "project.file.read", target: "/repo/project", sequence: 5, resultSummary: "ok", executedAt: new Date().toISOString() });
    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, { commandId: "c2", action: "project.file.read", target: "/repo/project", sequence: 3, resultSummary: "stale", executedAt: new Date().toISOString() })).rejects.toBeInstanceOf(DeviceGrantError);
    await expect(listDeviceCommandResults(pool, grant.grantId)).resolves.toHaveLength(1);
  });

  it("rejects a command after the grant is revoked, and revocation is idempotent", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    const revoked = await revokeDeviceGrant(pool, grant.grantId, proof, ceo(goalId));
    expect(revoked.state).toBe("revoked");
    const revokedAgain = await revokeDeviceGrant(pool, grant.grantId, proof, ceo(goalId));
    expect(revokedAgain.revokedAt).toBe(revoked.revokedAt);
    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-1", action: "project.file.read", target: "/repo/project", sequence: 1, resultSummary: "read", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantRevokedError);
  });

  it("rejects an expired grant's command", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 250).toISOString(), proof, ceo(goalId));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-1", action: "project.file.read", target: "/repo/project", sequence: 1, resultSummary: "read", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantExpiredError);
  });

  it("rejects a command once the Goal is closed, without requiring a separate grant-close pass", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    await pool.query("UPDATE goals SET state = 'stopped' WHERE goal_id = $1", [goalId]);
    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-1", action: "project.file.read", target: "/repo/project", sequence: 1, resultSummary: "read", executedAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(DeviceGrantExpiredError);
  });

  it("rejects direct tampering with an issued grant's identity or scope", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    await expect(pool.query("UPDATE device_grants SET action_types = '[\"external.send\"]'::jsonb WHERE grant_id = $1", [grant.grantId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM device_grants WHERE grant_id = $1", [grant.grantId])).rejects.toThrow();
  });

  it("denies a device command once the Goal is paused, matching every other Phase 2/3 write path", async () => {
    const { goalId, proof, deviceId } = await setupGoalAndDevice();
    const { grant, capabilityToken } = await createDeviceGrant(pool, goalId, deviceId, scope(), new Date(Date.now() + 60_000).toISOString(), proof, ceo(goalId));
    await pool.query(
      "INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) SELECT project_id, goal_id, transaction_timestamp(), transaction_timestamp() FROM goals WHERE goal_id = $1 ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = excluded.pause_requested_at, paused_at = excluded.paused_at",
      [goalId],
    );
    await expect(recordDeviceCommandResult(pool, grant.grantId, capabilityToken, {
      commandId: "command-1", action: "project.file.read", target: "/repo/project", sequence: 1, resultSummary: "read", executedAt: new Date().toISOString(),
    })).rejects.toThrow();
    await expect(listDeviceCommandResults(pool, grant.grantId)).resolves.toHaveLength(0);
  });

  it("throws DeviceGrantNotFoundError for a missing grant", async () => {
    await expect(revokeDeviceGrant(pool, randomUUID(), { goalId: randomUUID(), ownerId: "x", fencingToken: "1" }, ceo("x"))).rejects.toBeInstanceOf(DeviceGrantNotFoundError);
  });
});
