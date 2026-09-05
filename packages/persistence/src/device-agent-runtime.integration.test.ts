import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type DeviceGrantScope } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { createDeviceGrant } from "./device-grant.js";
import { enrollDevice, setLocalDevicePolicy } from "./device.js";
import { closeDeviceAgentSession, openDeviceAgentSession } from "./device-session.js";
import { claimDeviceAgentCommand, completeDeviceAgentCommand, loadDeviceAgentAuthorization, markUnresolvedDeviceAgentCommandsUnknown, type DeviceAgentCommandInput } from "./device-agent-runtime.js";
import { signDeviceGrantEnvelope, type UnsignedDeviceGrantEnvelope } from "@maestro/device-agent";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const { privateKey } = generateKeyPairSync("ed25519");
const issuerPublicKey = generateKeyPairSync("ed25519").publicKey;
const scope: DeviceGrantScope = { actionTypes: ["project.file.read"], projectPaths: ["/tmp/device-project"], applications: ["filesystem"], dataScope: ["/tmp/device-project/README.md"], networkScope: ["none"] };

describeDatabase("device agent durable command authority with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `device_runtime_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await applyAllMigrations(pool); });
  beforeEach(async () => { await pool.query("TRUNCATE device_command_claims, device_agent_sessions, device_command_results, device_grants, device_policies, devices, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("rechecks a live session/grant/Goal/device/policy and claims a sequence before recording a result", async () => {
    const goalId = randomUUID(); const projectId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "device-test", leaseDurationMs: 60_000 });
    const device = await enrollDevice(pool, { displayName: "test agent", deviceType: "computer", publicKey: "device-public-key" }, { actorId: "ceo", sessionRef: "session:ceo", role: "ceo" });
    await setLocalDevicePolicy(pool, device.deviceId, { rules: [{ action: "project.file.read", targets: ["/tmp/device-project/README.md"] }], expiresAt: null }, { actorId: "ceo", sessionRef: "session:ceo:policy", role: "ceo" });
    const issued = await createDeviceGrant(pool, goalId, device.deviceId, scope, new Date(Date.now() + 60_000).toISOString(), proof, { actorId: "ceo", sessionRef: "session:ceo:grant", role: "ceo" });
    const sessionId = randomUUID(); await openDeviceAgentSession(pool, sessionId, device.deviceId, device.identityFingerprint);
    const unsigned: UnsignedDeviceGrantEnvelope = { version: 1, grantId: issued.grant.grantId, commandId: randomUUID(), goalId, projectId, deviceId: device.deviceId, action: "project.file.read", target: "/tmp/device-project/README.md", projectPath: "/tmp/device-project", application: "filesystem", dataResource: "/tmp/device-project/README.md", networkTarget: "none", policyVersion: 2, goalFencingToken: proof.fencingToken, sequence: 1, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(), nonce: randomUUID(), issuerKeyId: "issuer-1" };
    const input: DeviceAgentCommandInput = { envelope: signDeviceGrantEnvelope(unsigned, privateKey), capabilityToken: issued.capabilityToken, sessionId };
    const auth = await loadDeviceAgentAuthorization(pool, input);
    expect(auth).toMatchObject({ goalId, projectId, grantId: issued.grant.grantId, deviceId: device.deviceId, policy: { policyVersion: 2 } });
    await claimDeviceAgentCommand(pool, input);
    await expect(claimDeviceAgentCommand(pool, input)).rejects.toThrow();
    const otherSessionId = randomUUID(); await openDeviceAgentSession(pool, otherSessionId, device.deviceId, device.identityFingerprint);
    await expect(completeDeviceAgentCommand(pool, { ...input, sessionId: otherSessionId }, "forged completion", new Date().toISOString())).rejects.toThrow();
    await closeDeviceAgentSession(pool, otherSessionId);
    await completeDeviceAgentCommand(pool, input, "read 5 bytes from project file", new Date().toISOString());
    const result = await pool.query<{ sequence: number; command_id: string }>("SELECT sequence, command_id FROM device_command_results WHERE grant_id = $1", [issued.grant.grantId]);
    expect(result.rows).toEqual([{ sequence: 1, command_id: input.envelope.commandId }]);
    const crashCommandId = randomUUID();
    await pool.query(`INSERT INTO device_command_claims (command_id, grant_id, session_id, goal_id, project_id, device_id, action, target, application, data_resource, network_target, policy_version, goal_fencing_token, sequence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::bigint, $14)`, [crashCommandId, issued.grant.grantId, sessionId, goalId, projectId, device.deviceId, "project.file.read", "/tmp/device-project/README.md", "filesystem", "/tmp/device-project/README.md", "none", 2, proof.fencingToken, 2]);
    expect(await markUnresolvedDeviceAgentCommandsUnknown(pool, device.deviceId)).toBe(1);
    const unknown = await pool.query<{ state: string; recovery_reason: string }>("SELECT state, recovery_reason FROM device_command_claims WHERE command_id = $1", [crashCommandId]);
    expect(unknown.rows[0]).toMatchObject({ state: "unknown", recovery_reason: "device-agent restart left command outcome unknown" });
    await expect(claimDeviceAgentCommand(pool, { ...input, envelope: { ...input.envelope, commandId: crashCommandId, sequence: 2 } })).rejects.toThrow("unresolved command outcome");
    await closeDeviceAgentSession(pool, sessionId);
    await expect(loadDeviceAgentAuthorization(pool, input)).rejects.toThrow();
  });
});
