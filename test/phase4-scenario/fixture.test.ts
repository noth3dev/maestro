import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveDiscordIncidentFingerprint, signDiscordSignal, verifyDiscordSignal } from "@maestro/domain";
import { createPhase4ScenarioFixture, assertPhase4ScenarioFixture } from "./fixture.mjs";

describe("Phase 4 scenario fixture", () => {
  it("creates both bounded live scenarios without touching testbed", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-phase4-"));
    const fixture = await createPhase4ScenarioFixture({ root });
    expect(fixture.root).toBe(root);
    expect(fixture.manifest.scenarios).toEqual(expect.arrayContaining(["narrow-grant", "incident-under-outage"]));
    expect(fixture.manifest.device.deviceId).toMatch(/^device-/);
    expect(fixture.manifest.device.certificatePath).toBe("device/device-cert.pem");
    expect(fixture.manifest.device.privateKeyPath).toBe("device/device-key.pem");
    expect(fixture.manifest.device.caPath).toBe("device/issuer-ca.pem");
    expect(fixture.manifest.incident.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(fixture.manifest.incident.signature).toMatch(/^[0-9a-f]+$/);
    expect(fixture.manifest.outOfScopeActions).toEqual([
      { scenario: "narrow-grant", capabilityKind: "device", action: "browser.navigate", target: "https://example.invalid" },
      { scenario: "incident-under-outage", capabilityKind: "deployment", action: "git.push", target: "origin/main" },
    ]);
    expect((await stat(join(root, "device/issuer-signing-key.pem"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "discord-secret.txt"))).mode & 0o777).toBe(0o600);
    const envelope = JSON.parse(await readFile(join(root, "incident-envelope.json"), "utf8"));
    const secret = (await readFile(join(root, "discord-secret.txt"), "utf8")).trim();
    expect(deriveDiscordIncidentFingerprint(envelope.signal)).toBe(envelope.signal.incidentFingerprint);
    expect(() => verifyDiscordSignal(envelope, secret, Date.now(), 300_000)).not.toThrow();
    await expect(assertPhase4ScenarioFixture(root)).resolves.toMatchObject({ root });
    await expect(readFile(join(root, "manifest.json"), "utf8")).resolves.toContain("incident-under-outage");
    const changed = signDiscordSignal(envelope.signal, secret, "evil-replay-nonce", envelope.sequence, envelope.issuedAt);
    await writeFile(join(root, "incident-envelope.json"), JSON.stringify(changed, null, 2) + "\n");
    await expect(assertPhase4ScenarioFixture(root)).rejects.toThrow(/manifest incident metadata|replay|freshness/);
  });

  it("rejects testbed and symlink roots before writing", async () => {
    await expect(createPhase4ScenarioFixture({ root: resolve(process.cwd(), "testbed") })).rejects.toThrow(/testbed/);
    const parent = await mkdtemp(join(tmpdir(), "maestro-phase4-link-"));
    const link = join(parent, "fixture");
    await symlink(resolve(process.cwd(), "testbed"), link, "dir");
    await expect(createPhase4ScenarioFixture({ root: link })).rejects.toThrow(/symlink|testbed/);
  });
});
