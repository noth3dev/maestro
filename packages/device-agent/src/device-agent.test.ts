import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deviceIdentityFingerprint, type DeviceEnrollment, type DeviceGrantEnvelope, type DeviceGrantScope, type LocalDevicePolicy } from "@maestro/domain";
import { DeviceFenceState } from "./fence-state.js";
import { createBoundedProjectFileReader } from "./file-executor.js";
import { signDeviceGrantEnvelope, verifyDeviceGrantEnvelope, type UnsignedDeviceGrantEnvelope } from "./envelope.js";
import { assertLocallyExecutableDeviceGrant, LocalDeviceGrantDeniedError } from "./local.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const deviceId = randomUUID();
const enrollment: DeviceEnrollment = { deviceId, displayName: "test device", deviceType: "computer", publicKey: "public-key", identityFingerprint: deviceIdentityFingerprint("public-key"), enrolledBy: "test", enrolledAt: "2020-01-01T00:00:00.000Z", state: "enrolled", revokedAt: null };
const scope: DeviceGrantScope = { actionTypes: ["project.file.read"], projectPaths: ["/tmp/project"], applications: ["filesystem"], dataScope: ["/tmp/project/README.md"], networkScope: ["none"] };
const policy: LocalDevicePolicy = { deviceId, policyVersion: 3, rules: [{ action: "project.file.read", targets: ["/tmp/project/README.md"] }], expiresAt: null };
const envelope = (overrides: Partial<UnsignedDeviceGrantEnvelope> = {}): DeviceGrantEnvelope => signDeviceGrantEnvelope({
  version: 1, grantId: "grant-1", commandId: "command-1", goalId: "goal-1", projectId: "project-1", deviceId, action: "project.file.read", target: "/tmp/project/README.md", projectPath: "/tmp/project", application: "filesystem", dataResource: "/tmp/project/README.md", networkTarget: "none", policyVersion: 3, goalFencingToken: "4", sequence: 1, issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", nonce: randomUUID(), issuerKeyId: "issuer-1", ...overrides,
}, privateKey);

describe("device-agent signed envelope and local boundary", () => {
  it("signs and verifies the exact envelope payload", () => {
    const value = envelope();
    expect(verifyDeviceGrantEnvelope(value, publicKey)).toBe(true);
    expect(verifyDeviceGrantEnvelope({ ...value, target: "/tmp/project/other" }, publicKey)).toBe(false);
  });

  it("allows a bounded in-scope command and rejects stale fence, replay, and scope escapes locally", () => {
    const value = envelope();
    const context = { enrollment: { ...enrollment, identityFingerprint: deviceIdentityFingerprint("public-key") }, policy, scope, expectedGoalId: "goal-1", expectedProjectId: "project-1", expectedGrantId: "grant-1", issuerKeyId: "issuer-1", issuerPublicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), previousGoalFencingToken: "4", previousSequence: 0 };
    expect(() => assertLocallyExecutableDeviceGrant(value, context)).not.toThrow();
    for (const invalid of [
      envelope({ goalId: "other-goal" }), envelope({ goalFencingToken: "3" }), envelope({ target: "/etc/passwd", dataResource: "/etc/passwd" }), envelope({ application: "browser" }), envelope({ networkTarget: "https://example.com" }),
    ]) expect(() => assertLocallyExecutableDeviceGrant(invalid, context)).toThrow(LocalDeviceGrantDeniedError);
    expect(() => assertLocallyExecutableDeviceGrant(envelope(), { ...context, previousSequence: 1 })).toThrow(LocalDeviceGrantDeniedError);
  });

  it("persists a monotonic fence/sequence across agent restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-device-fence-"));
    const path = join(directory, "fence.json");
    const first = await DeviceFenceState.open(path, deviceId);
    await first.advance("grant-1", "8", 4);
    const restarted = await DeviceFenceState.open(path, deviceId);
    expect(restarted.previous("grant-1")).toEqual({ fence: "8", sequence: 4 });
    await expect(restarted.advance("grant-1", "7", 3)).resolves.toBeUndefined();
    expect(restarted.previous("grant-1")).toEqual({ fence: "8", sequence: 4 });
  });

  it("reads only a bounded file below the configured project root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-device-project-"));
    await writeFile(join(directory, "README.md"), "hello");
    const reader = createBoundedProjectFileReader(directory, 32);
    await expect(reader.execute("project.file.read", join(directory, "README.md"))).resolves.toMatchObject({ resultSummary: "read 5 bytes from project file" });
    await expect(reader.execute("project.file.read", "/etc/passwd")).rejects.toThrow();
    await expect(readFile(join(directory, "README.md"), "utf8")).resolves.toBe("hello");
  });
});
