import { describe, expect, it } from "vitest";
import {
  LocalDevicePolicyAgent,
  assertValidDeviceInventory,
  assertValidLocalDevicePolicy,
  deviceIdentityFingerprint,
  type DeviceEnrollment,
  type DeviceInventory,
  type LocalDevicePolicy,
} from "./device.js";

const enrollment = (overrides: Partial<DeviceEnrollment> = {}): DeviceEnrollment => ({
  deviceId: "device-1",
  displayName: "Build laptop",
  deviceType: "computer",
  publicKey: "public-key-a",
  identityFingerprint: deviceIdentityFingerprint("public-key-a"),
  enrolledBy: "ceo",
  enrolledAt: "2030-01-01T00:00:00.000Z",
  state: "enrolled",
  revokedAt: null,
  ...overrides,
});

const inventory = (overrides: Partial<DeviceInventory> = {}): DeviceInventory => ({
  observedAt: "2030-01-01T00:00:00.000Z",
  platform: "linux",
  architecture: "x64",
  capabilities: [{ name: "node", version: "24" }],
  applications: [{ name: "chromium", version: "130" }],
  ...overrides,
});

const policy = (overrides: Partial<LocalDevicePolicy> = {}): LocalDevicePolicy => ({
  deviceId: "device-1",
  policyVersion: 1,
  rules: [{ action: "project.file.read", targets: ["/repo/README.md"] }],
  expiresAt: null,
  ...overrides,
});

describe("device enrollment identity", () => {
  it("derives a stable fingerprint from the public key and changes when the key changes", () => {
    expect(deviceIdentityFingerprint("public-key-a")).toBe(deviceIdentityFingerprint(" public-key-a "));
    expect(deviceIdentityFingerprint("public-key-a")).not.toBe(deviceIdentityFingerprint("public-key-b"));
  });

  it("rejects private-key material as an enrollment identity", () => {
    expect(() => deviceIdentityFingerprint("-----BEGIN PRIVATE KEY-----secret"))
      .toThrow(/public key/i);
  });
});

describe("local device policy agent", () => {
  it("does not infer permission from an inventoried capability", () => {
    const agent = new LocalDevicePolicyAgent(enrollment(), policy());
    const decision = agent.evaluate({
      deviceId: "device-1",
      identityFingerprint: enrollment().identityFingerprint,
      action: "node",
      target: "/repo",
    }, new Date("2030-01-01T00:00:00.000Z"));
    expect(decision).toMatchObject({ allowed: false, reason: "action_not_allowed" });
  });

  it("allows only an explicitly listed action and exact target", () => {
    const e = enrollment();
    const agent = new LocalDevicePolicyAgent(e, policy());
    expect(agent.evaluate({ deviceId: e.deviceId, identityFingerprint: e.identityFingerprint, action: "project.file.read", target: "/repo/README.md" })).toMatchObject({ allowed: true, reason: "allowed" });
    expect(agent.evaluate({ deviceId: e.deviceId, identityFingerprint: e.identityFingerprint, action: "project.file.read", target: "/repo/secrets.env" })).toMatchObject({ allowed: false, reason: "target_not_allowed" });
  });

  it("rejects an identity mismatch and a revoked enrollment before policy matching", () => {
    const e = enrollment();
    const agent = new LocalDevicePolicyAgent(e, policy());
    expect(agent.evaluate({ deviceId: "other-device", identityFingerprint: e.identityFingerprint, action: "project.file.read", target: "/repo/README.md" })).toMatchObject({ allowed: false, reason: "device_identity_mismatch" });
    expect(new LocalDevicePolicyAgent({ ...e, state: "revoked", revokedAt: "2030-01-02T00:00:00.000Z" }, policy()).evaluate({ deviceId: e.deviceId, identityFingerprint: e.identityFingerprint, action: "project.file.read", target: "/repo/README.md" })).toMatchObject({ allowed: false, reason: "device_revoked" });
  });

  it("never authorizes critical effects through local policy alone", () => {
    for (const action of ["external.send", "deployment.release", "payment.charge", "permission.change", "git.remote.push", "PERMANENT.DELETE"]) {
      expect(() => assertValidLocalDevicePolicy(policy({ rules: [{ action, targets: ["target"] }] }))).toThrow(/critical|policy/i);
      const agent = new LocalDevicePolicyAgent(enrollment(), policy());
      expect(agent.evaluate({ deviceId: "device-1", identityFingerprint: enrollment().identityFingerprint, action, target: "target" })).toMatchObject({ allowed: false, reason: "critical_action_requires_goal_grant" });
    }
  });

  it("fails closed for an expired policy, a mismatched policy, and a malformed request", () => {
    const e = enrollment();
    expect(new LocalDevicePolicyAgent(e, policy({ expiresAt: "2029-12-31T23:59:59.000Z" })).evaluate({ deviceId: e.deviceId, identityFingerprint: e.identityFingerprint, action: "project.file.read", target: "/repo/README.md" }, new Date("2030-01-01T00:00:00.000Z"))).toMatchObject({ allowed: false, reason: "policy_expired" });
    expect(new LocalDevicePolicyAgent(e, policy({ deviceId: "other-device" })).evaluate({ deviceId: e.deviceId, identityFingerprint: e.identityFingerprint, action: "project.file.read", target: "/repo/README.md" })).toMatchObject({ allowed: false, reason: "policy_device_mismatch" });
    expect(new LocalDevicePolicyAgent(e, policy()).evaluate(null as never)).toMatchObject({ allowed: false, reason: "invalid_request" });
  });

  it("validates an inventory without accepting arbitrary secret-like fields", () => {
    expect(() => assertValidDeviceInventory({ ...inventory(), capabilities: [{ name: "token=secret", version: "1" }] })).toThrow();
    expect(() => assertValidDeviceInventory({ ...inventory(), applications: [{ name: "node", version: "TOKEN=plaintext" }] })).toThrow();
    expect(() => assertValidDeviceInventory({ ...inventory(), unknown: "must not be persisted" })).toThrow();
    expect(() => assertValidDeviceInventory({ ...inventory(), capabilities: [{ name: "node", version: "1", secret: "value" }] })).toThrow();
  });
});
