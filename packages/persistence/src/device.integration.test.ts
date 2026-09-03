import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InvalidDeviceInventoryError, deviceIdentityFingerprint, type DeviceInventory, type LocalDevicePolicyInput } from "@maestro/domain";
import {
  DeviceAuthorizationError,
  DeviceError,
  DeviceNotFoundError,
  DeviceRevokedError,
  enrollDevice,
  evaluateDevicePolicy,
  listDevices,
  readDevice,
  recordDeviceInventory,
  revokeDevice,
  setLocalDevicePolicy,
} from "./device.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0040_devices.sql", "0041_device_policy_hardening.sql"];

const inventory = (overrides: Partial<DeviceInventory> = {}): DeviceInventory => ({
  observedAt: "2030-01-01T00:00:00.000Z",
  platform: "linux",
  architecture: "x64",
  capabilities: [{ name: "node", version: "24" }],
  applications: [{ name: "chromium", version: "130" }],
  ...overrides,
});
const policy = (overrides: Partial<LocalDevicePolicyInput> = {}): LocalDevicePolicyInput => ({
  rules: [{ action: "project.file.read", targets: ["/repo/README.md"] }],
  expiresAt: null,
  ...overrides,
});

const context = (role: "ceo" | "device_agent", deviceId?: string, identityFingerprint?: string) => ({
  actorId: role === "ceo" ? "ceo" : "device-agent",
  sessionRef: `session:${role}:${deviceId ?? "operator"}`,
  role,
  ...(deviceId === undefined ? {} : { deviceId }),
  ...(identityFingerprint === undefined ? {} : { identityFingerprint }),
});

 describeDatabase("device enrollment and local policy persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS device_policies, devices CASCADE");
    for (const name of migrations) await pool.query(await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8"));
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE device_policies, devices RESTART IDENTITY CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("reapplies the device migration without changing the durable schema", async () => {
    await expect(pool.query(await readFile(fileURLToPath(new URL("../migrations/0040_devices.sql", import.meta.url)), "utf8"))).resolves.toBeDefined();
    const tables = await pool.query<{ relname: string }>("SELECT relname FROM pg_class WHERE relname IN ('devices', 'device_policies') AND relkind = 'r' ORDER BY relname");
    expect(tables.rows.map((row) => row.relname)).toEqual(["device_policies", "devices"]);
  });

  it("explicitly enrolls a durable device with a default-deny local policy and no Goal authority", async () => {
    const beforeGoals = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM goals");
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-a" }, context("ceo"));
    expect(device).toMatchObject({
      displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-a", state: "enrolled", revokedAt: null,
      identityFingerprint: deviceIdentityFingerprint("public-key-a"), inventory: null,
      policy: { policyVersion: 1, rules: [], expiresAt: null },
    });
    const afterGoals = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM goals");
    expect(afterGoals.rows[0]!.count).toBe(beforeGoals.rows[0]!.count);
    expect((await readDevice(pool, device.deviceId))?.deviceId).toBe(device.deviceId);
    expect((await listDevices(pool)).map((entry) => entry.deviceId)).toEqual([device.deviceId]);
    await expect(enrollDevice(pool, { displayName: "Duplicate", deviceType: "computer", publicKey: " public-key-a " }, context("ceo"))).rejects.toBeInstanceOf(DeviceError);
  });

  it("requires an explicit CEO context for enrollment, policy, and revocation", async () => {
    await expect(enrollDevice(pool, { displayName: "Untrusted", deviceType: "computer", publicKey: "public-key-b" }, context("device_agent", "not-enrolled"))).rejects.toBeInstanceOf(DeviceAuthorizationError);
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-c" }, context("ceo"));
    await expect(setLocalDevicePolicy(pool, device.deviceId, policy(), context("device_agent", device.deviceId, device.identityFingerprint))).rejects.toBeInstanceOf(DeviceAuthorizationError);
    await expect(revokeDevice(pool, device.deviceId, context("device_agent", device.deviceId, device.identityFingerprint))).rejects.toBeInstanceOf(DeviceAuthorizationError);
    expect((await readDevice(pool, device.deviceId))?.state).toBe("enrolled");
  });

  it("requires a device agent to bind to the enrolled device identity", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-agent-binding" }, context("ceo"));
    await expect(recordDeviceInventory(pool, device.deviceId, inventory(), context("device_agent"))).rejects.toBeInstanceOf(DeviceAuthorizationError);
    await expect(recordDeviceInventory(pool, device.deviceId, inventory(), context("device_agent", "other-device", device.identityFingerprint))).rejects.toBeInstanceOf(DeviceAuthorizationError);
    await expect(recordDeviceInventory(pool, device.deviceId, inventory(), context("device_agent", device.deviceId, "0".repeat(64)))).rejects.toBeInstanceOf(DeviceAuthorizationError);
    await expect(recordDeviceInventory(pool, device.deviceId, inventory(), context("device_agent", device.deviceId, device.identityFingerprint))).resolves.toMatchObject({ inventory: inventory() });
  });

  it("records inventory as observed state while rejecting secrets and unknown fields at the database boundary", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-d" }, context("ceo"));
    await expect(recordDeviceInventory(pool, device.deviceId, inventory(), context("ceo"))).resolves.toMatchObject({ inventory: inventory() });
    const invalidInventoryError = await recordDeviceInventory(
      pool,
      device.deviceId,
      { ...inventory(), capabilities: [{ name: "token=secret", version: "1" }] },
      context("ceo"),
    ).then(() => undefined, (error: unknown) => error);
    expect(invalidInventoryError).toBeInstanceOf(DeviceError);
    expect((invalidInventoryError as { cause?: unknown }).cause).toBeInstanceOf(InvalidDeviceInventoryError);
    await expect(pool.query(
      "UPDATE devices SET inventory = $2::jsonb, inventory_updated_at = clock_timestamp() WHERE device_id = $1",
      [device.deviceId, JSON.stringify({ ...inventory(), applications: [{ name: "node", version: "TOKEN=plaintext" }] })],
    )).rejects.toThrow(/inventory|secret/i);
    await expect(pool.query(
      "UPDATE devices SET inventory = $2::jsonb, inventory_updated_at = clock_timestamp() WHERE device_id = $1",
      [device.deviceId, JSON.stringify({ ...inventory(), unknown: "must not be persisted" })],
    )).rejects.toThrow(/inventory|field/i);
  });

  it("persists an explicit local policy and evaluates exact action and target scope", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "cli_endpoint", publicKey: "public-key-e" }, context("ceo"));
    const configured = await setLocalDevicePolicy(pool, device.deviceId, policy(), context("ceo"));
    expect(configured.policy).toMatchObject({ deviceId: device.deviceId, policyVersion: 2, rules: policy().rules });
    const request = { deviceId: device.deviceId, identityFingerprint: device.identityFingerprint, action: "project.file.read", target: "/repo/README.md" };
    await expect(evaluateDevicePolicy(pool, request)).resolves.toMatchObject({ allowed: true, reason: "allowed", policyVersion: 2 });
    await expect(evaluateDevicePolicy(pool, { ...request, target: "/repo/secrets.env" })).resolves.toMatchObject({ allowed: false, reason: "target_not_allowed" });
    await expect(evaluateDevicePolicy(pool, { ...request, action: "node", target: "/repo" })).resolves.toMatchObject({ allowed: false, reason: "action_not_allowed" });
  });

  it("rejects a directly injected policy version that is not the next revision", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-policy-sequence" }, context("ceo"));
    const configured = await setLocalDevicePolicy(pool, device.deviceId, policy(), context("ceo"));
    await expect(pool.query(
      "INSERT INTO device_policies (device_id, policy_version, rules, set_by) VALUES ($1, 99, $2::jsonb, 'attacker')",
      [device.deviceId, JSON.stringify(policy().rules)],
    )).rejects.toThrow(/next|version|revision|append/i);
    expect((await readDevice(pool, device.deviceId))?.policy.policyVersion).toBe(configured.policy.policyVersion);
    await expect(setLocalDevicePolicy(pool, device.deviceId, policy({ rules: [{ action: "project.file.write", targets: ["/repo/README.md"] }] }), context("ceo"))).resolves.toMatchObject({ policy: { policyVersion: 3 } });
  });

  it("rejects an unrecognized policy field instead of silently widening or dropping policy input", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-extra-field" }, context("ceo"));
    await expect(setLocalDevicePolicy(pool, device.deviceId, { ...policy(), extra: "unexpected" } as never, context("ceo"))).rejects.toThrow(/unknown|policy/i);
    expect((await readDevice(pool, device.deviceId))?.policy.policyVersion).toBe(1);
  });

  it("revokes immediately and permanently blocks reuse until a new enrollment", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-f" }, context("ceo"));
    await setLocalDevicePolicy(pool, device.deviceId, policy(), context("ceo"));
    const revoked = await revokeDevice(pool, device.deviceId, context("ceo"));
    expect(revoked).toMatchObject({ state: "revoked" });
    const request = { deviceId: device.deviceId, identityFingerprint: device.identityFingerprint, action: "project.file.read", target: "/repo/README.md" };
    await expect(evaluateDevicePolicy(pool, request)).resolves.toMatchObject({ allowed: false, reason: "device_revoked" });
    await expect(recordDeviceInventory(pool, device.deviceId, inventory(), context("ceo"))).rejects.toBeInstanceOf(DeviceRevokedError);
    await expect(setLocalDevicePolicy(pool, device.deviceId, policy(), context("ceo"))).rejects.toBeInstanceOf(DeviceRevokedError);
    await expect(revokeDevice(pool, device.deviceId, context("ceo"))).resolves.toEqual(revoked);
    await expect(pool.query("UPDATE devices SET state = 'enrolled', revoked_at = NULL WHERE device_id = $1", [device.deviceId])).rejects.toThrow(/revoc|state/i);
    const reenrolled = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-f2" }, context("ceo"));
    expect(reenrolled.deviceId).not.toBe(device.deviceId);
    expect(reenrolled.state).toBe("enrolled");
  });

  it("keeps policy revisions append-only and rejects critical policy rules", async () => {
    const device = await enrollDevice(pool, { displayName: "Build laptop", deviceType: "computer", publicKey: "public-key-policy-immutable" }, context("ceo"));
    const configured = await setLocalDevicePolicy(pool, device.deviceId, policy(), context("ceo"));
    await expect(pool.query("UPDATE device_policies SET rules = '[]'::jsonb WHERE device_id = $1 AND policy_version = $2", [device.deviceId, configured.policy.policyVersion])).rejects.toThrow(/immutable|append-only/i);
    await expect(pool.query("DELETE FROM device_policies WHERE device_id = $1 AND policy_version = $2", [device.deviceId, configured.policy.policyVersion])).rejects.toThrow(/immutable|append-only/i);
    for (const action of [
      "external.send",
      "EXTERNAL__SEND",
      "external / send",
      "SYSTEM_POLICY_BYPASS",
      "permanent-delete",
      "deployment.release",
      "payment.charge",
      "permission.change",
      "authority.grant",
      "git remote push",
    ]) {
      await expect(pool.query(
        "INSERT INTO device_policies (device_id, policy_version, rules, set_by) VALUES ($1, 99, $2::jsonb, 'ceo')",
        [device.deviceId, JSON.stringify([{ action, targets: ["smtp://mail"] }])],
      )).rejects.toThrow(/critical|policy/i);
    }
    await revokeDevice(pool, device.deviceId, context("ceo"));
    await expect(pool.query("INSERT INTO device_policies (device_id, policy_version, rules, set_by) VALUES ($1, 99, '[]'::jsonb, 'ceo')", [device.deviceId])).rejects.toThrow(/revoked|policy/i);
    await expect(pool.query("UPDATE devices SET inventory_updated_at = clock_timestamp() WHERE device_id = $1", [device.deviceId])).rejects.toThrow(/revoked|inventory/i);
  });

  it("does not expose a missing device as usable policy state", async () => {
    await expect(readDevice(pool, randomUUID())).resolves.toBeUndefined();
    await expect(evaluateDevicePolicy(pool, { deviceId: randomUUID(), identityFingerprint: "0".repeat(64), action: "project.file.read", target: "/repo" })).rejects.toBeInstanceOf(DeviceNotFoundError);
  });
});
