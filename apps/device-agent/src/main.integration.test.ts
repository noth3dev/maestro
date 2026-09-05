import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deviceIdentityFingerprint, type DeviceGrantScope } from "@maestro/domain";
import { signDeviceGrantEnvelope, type UnsignedDeviceGrantEnvelope } from "@maestro/device-agent";
import { applyAllMigrations, acquireGoalLease, bootstrapPermanentOrganization, createDeviceGrant, enrollDevice, revokeDevice, setLocalDevicePolicy } from "@maestro/persistence";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const controlHarness = fileURLToPath(new URL("../../control-plane/src/process-control-plane-harness.mjs", import.meta.url));
const providerHarness = fileURLToPath(new URL("../../control-plane/src/process-provider-tcp-harness.mjs", import.meta.url));

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<{ port: number }> {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n"); if (newline < 0) return;
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        try { const parsed = JSON.parse(line) as { ready?: boolean; port?: number }; if (parsed.ready === true && typeof parsed.port === "number") { child.stdout.off("data", onData); resolve({ port: parsed.port }); return; } } catch { /* wait for ready line */ }
      }
    };
    child.stdout.on("data", onData); child.once("error", reject); child.once("exit", (code, signal) => reject(new Error(`process exited before ready: ${code ?? signal}`)));
  });
}
async function exit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
async function startProvider(): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const child = spawn(process.execPath, [providerHarness], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  return { child, ...(await waitForReady(child)) };
}
async function startControlPlane(database: string, providerPort: number): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const child = spawn(process.execPath, [controlHarness], {
    cwd: process.cwd(), env: { ...process.env, MAESTRO_PROVIDER_PORT: String(providerPort), MAESTRO_CONTROL_PLANE_CONFIG: JSON.stringify({ databaseUrl: database, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `device-test-${randomUUID()}`, reconcilerLeaseDurationMs: 30_000, shutdownDrainTimeoutMs: 100 }) }, stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, ...(await waitForReady(child)) };
}
function runOpenSsl(args: string[]): void { execFileSync("openssl", args, { stdio: "ignore" }); }
async function createTlsMaterial(directory: string, devicePrivatePem: string): Promise<{ ca: string; serverKey: string; serverCert: string; deviceKey: string; deviceCert: string; otherKey: string; otherCert: string }> {
  const caKey = join(directory, "ca.key"); const ca = join(directory, "ca.pem");
  runOpenSsl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", ca, "-days", "1", "-subj", "/CN=maestro-device-test-ca"]);
  const make = (name: string, subject: string, ext?: string) => {
    const key = join(directory, `${name}.key`); const csr = join(directory, `${name}.csr`); const cert = join(directory, `${name}.pem`);
    if (name === "device") void writeFile(key, devicePrivatePem); else runOpenSsl(["genrsa", "-out", key, "2048"]);
    runOpenSsl(["req", "-new", "-key", key, "-out", csr, "-subj", subject]);
    const args = ["x509", "-req", "-in", csr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", "1", "-sha256"];
    if (ext) args.push("-extfile", ext);
    runOpenSsl(args); return { key, cert };
  };
  const ext = join(directory, "server.ext"); await writeFile(ext, "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth");
  const server = make("server", "/CN=localhost", ext);
  const device = { key: join(directory, "device.key"), cert: join(directory, "device.pem") }; await writeFile(device.key, devicePrivatePem);
  const deviceCsr = join(directory, "device.csr"); const deviceExt = join(directory, "device.ext"); await writeFile(deviceExt, "extendedKeyUsage=clientAuth"); runOpenSsl(["req", "-new", "-key", device.key, "-out", deviceCsr, "-subj", "/CN=enrolled-device"]); runOpenSsl(["x509", "-req", "-in", deviceCsr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-out", device.cert, "-days", "1", "-sha256", "-extfile", deviceExt]);
  const other = make("other", "/CN=not-enrolled");
  return { ca, serverKey: server.key, serverCert: server.cert, deviceKey: device.key, deviceCert: device.cert, otherKey: other.key, otherCert: other.cert };
}
function requestDevice(port: number, tls: { ca: Buffer; key: Buffer; cert: Buffer }, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = https.request({ host: "127.0.0.1", port, path: "/v1/device/commands", method: "POST", ca: tls.ca, key: tls.key, cert: tls.cert, servername: "localhost", rejectUnauthorized: true, agent: false, headers: { "content-type": "application/json", connection: "close" } }, (response) => {
      let text = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { text += chunk; }); response.on("end", () => { try { resolve({ status: response.statusCode ?? 0, json: JSON.parse(text) as Record<string, unknown> }); } catch (error) { reject(error); } });
    });
    request.on("error", reject); request.end(JSON.stringify(body));
  });
}

describeDatabase("real device-agent mTLS and signed grant process", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `device_agent_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await applyAllMigrations(pool); });
  beforeEach(async () => { await pool.query("TRUNCATE device_command_claims, device_agent_sessions, device_command_results, device_grants, device_policies, devices, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls, local_operator_credentials, local_operators, operator_project_memberships CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("executes one real file read only after mTLS, signature, local fence, and durable grant rechecks", async () => {
    const tlsDir = await mkdtemp(join(tmpdir(), "maestro-device-tls-"));
    const issuer = generateKeyPairSync("ed25519"); const deviceKeys = generateKeyPairSync("ed25519"); const otherKeys = generateKeyPairSync("ed25519");
    const devicePublic = deviceKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const tls = await createTlsMaterial(tlsDir, deviceKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const goalId = randomUUID(); const projectId = randomUUID(); const projectRoot = await mkdtemp(join(tmpdir(), "maestro-device-project-")); const target = join(projectRoot, "README.md"); await writeFile(target, "hello device");
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "device-authority-test", leaseDurationMs: 60_000 });
    const device = await enrollDevice(pool, { displayName: "real agent", deviceType: "computer", publicKey: devicePublic }, { actorId: "ceo", sessionRef: "session:ceo:device", role: "ceo" });
    await setLocalDevicePolicy(pool, device.deviceId, { rules: [{ action: "project.file.read", targets: [target] }], expiresAt: null }, { actorId: "ceo", sessionRef: "session:ceo:policy", role: "ceo" });
    const grantScope: DeviceGrantScope = { actionTypes: ["project.file.read"], projectPaths: [projectRoot], applications: ["filesystem"], dataScope: [target], networkScope: ["none"] };
    const issued = await createDeviceGrant(pool, goalId, device.deviceId, grantScope, new Date(Date.now() + 120_000).toISOString(), proof, { actorId: "ceo", sessionRef: "session:ceo:grant", role: "ceo" });
    const provider = await startProvider(); const control = await startControlPlane(scopedUrl, provider.port);
    const statePath = join(tlsDir, "fence.json");
    const agentEnv = { ...process.env, MAESTRO_DEVICE_AGENT_CONFIG: JSON.stringify({ databaseUrl: scopedUrl, host: "127.0.0.1", port: 0, deviceId: device.deviceId, identityFingerprint: device.identityFingerprint, issuerKeyId: "issuer-1", issuerPublicKey: issuer.publicKey.export({ type: "spki", format: "pem" }).toString(), keyPath: tls.serverKey, certPath: tls.serverCert, caPath: tls.ca, statePath, projectRoot, maxReadBytes: 1024 }) };
    let agent = spawn(process.execPath, ["apps/device-agent/dist/main.js"], { cwd: process.cwd(), env: agentEnv, stdio: ["ignore", "pipe", "pipe"] });
    try {
      let ready = await waitForReady(agent);
      const makeEnvelope = (overrides: Partial<UnsignedDeviceGrantEnvelope> = {}) => signDeviceGrantEnvelope({ version: 1, grantId: issued.grant.grantId, commandId: randomUUID(), goalId, projectId, deviceId: device.deviceId, action: "project.file.read", target, projectPath: projectRoot, application: "filesystem", dataResource: target, networkTarget: "none", policyVersion: 2, goalFencingToken: proof.fencingToken, sequence: 1, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: randomUUID(), issuerKeyId: "issuer-1", ...overrides }, issuer.privateKey);
      const command = makeEnvelope(); const commandBody = { envelope: command, capabilityToken: issued.capabilityToken };
      await expect(requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, commandBody)).resolves.toMatchObject({ status: 200, json: { ok: true, resultSummary: "read 12 bytes from project file" } });
      const resultCount = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM device_command_results WHERE grant_id = $1", [issued.grant.grantId]); expect(resultCount.rows[0]!.count).toBe(1);
      const replay = await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, commandBody); expect(replay.status).toBe(403);
      const badSignature = { ...makeEnvelope({ sequence: 2 }), signature: "bad" }; expect((await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, { envelope: badSignature, capabilityToken: issued.capabilityToken })).status).toBe(403);
      expect((await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, { envelope: makeEnvelope({ sequence: 2, target: "/etc/passwd", dataResource: "/etc/passwd" }), capabilityToken: issued.capabilityToken })).status).toBe(403);
      expect((await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, { envelope: makeEnvelope({ sequence: 2, issuedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() - 1_000).toISOString() }), capabilityToken: issued.capabilityToken })).status).toBe(403);
      expect((await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, { envelope: makeEnvelope({ sequence: 2, goalFencingToken: "999" }), capabilityToken: issued.capabilityToken })).status).toBe(403);
      expect((await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, { envelope: makeEnvelope({ sequence: 2, policyVersion: 1 }), capabilityToken: issued.capabilityToken })).status).toBe(403);
      await expect(requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.otherKey), cert: await readFile(tls.otherCert) }, { envelope: makeEnvelope({ sequence: 2 }), capabilityToken: issued.capabilityToken })).rejects.toThrow();
      // Crash after the durable claim and local fence write, while the real
      // executor is deliberately held. Restarting must classify that outcome
      // as unknown and block the grant rather than guess or duplicate it.
      const crashCommand = makeEnvelope({ sequence: 2 });
      const crashBody = { envelope: crashCommand, capabilityToken: issued.capabilityToken };
      agent.kill("SIGTERM"); await exit(agent);
      const crashEnv = { ...agentEnv, MAESTRO_TEST_DEVICE_BEFORE_EFFECT_DELAY_MS: "5000" };
      agent = spawn(process.execPath, ["apps/device-agent/dist/main.js"], { cwd: process.cwd(), env: crashEnv, stdio: ["ignore", "pipe", "pipe"] });
      ready = await waitForReady(agent);
      const pendingCrash = requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, crashBody).then(() => undefined, (error: unknown) => error);
      await expect.poll(async () => (await pool.query<{ state: string }>("SELECT state FROM device_command_claims WHERE command_id = $1", [crashCommand.commandId])).rows[0]?.state).toBe("claimed");
      agent.kill("SIGKILL"); await exit(agent); expect(await pendingCrash).toBeInstanceOf(Error);
      agent = spawn(process.execPath, ["apps/device-agent/dist/main.js"], { cwd: process.cwd(), env: agentEnv, stdio: ["ignore", "pipe", "pipe"] });
      ready = await waitForReady(agent);
      expect(await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, crashBody)).toMatchObject({ status: 403 });
      const unknownCrash = await pool.query<{ state: string }>("SELECT state FROM device_command_claims WHERE command_id = $1", [crashCommand.commandId]); expect(unknownCrash.rows[0]!.state).toBe("unknown");
      await revokeDevice(pool, device.deviceId, { actorId: "ceo", sessionRef: "session:ceo:revoke", role: "ceo" });
      expect((await requestDevice(ready.port, { ca: await readFile(tls.ca), key: await readFile(tls.deviceKey), cert: await readFile(tls.deviceCert) }, { envelope: makeEnvelope({ sequence: 3 }), capabilityToken: issued.capabilityToken })).status).toBe(403);
      const claims = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM device_command_claims WHERE grant_id = $1", [issued.grant.grantId]); expect(claims.rows[0]!.count).toBe(2);
      agent.kill("SIGTERM"); await exit(agent);
      await expect.poll(async () => (await pool.query<{ state: string }>("SELECT state FROM device_agent_sessions ORDER BY connected_at DESC LIMIT 1")).rows[0]?.state).toBe("disconnected");
      const missing = spawn(process.execPath, ["apps/device-agent/dist/main.js"], { cwd: process.cwd(), env: { ...process.env, MAESTRO_DEVICE_AGENT_CONFIG: JSON.stringify({ databaseUrl: scopedUrl, host: "127.0.0.1", port: 0, deviceId: device.deviceId, identityFingerprint: device.identityFingerprint, issuerKeyId: "issuer-1", issuerPublicKey: issuer.publicKey.export({ type: "spki", format: "pem" }).toString(), keyPath: join(tlsDir, "missing.key"), certPath: tls.serverCert, caPath: tls.ca, statePath, projectRoot }) }, stdio: ["ignore", "pipe", "pipe"] }); await exit(missing); expect(missing.exitCode).not.toBe(0);
    } finally {
      if (agent.exitCode === null) { agent.kill("SIGKILL"); await exit(agent); }
      if (control.child.exitCode === null) { control.child.kill("SIGTERM"); await exit(control.child); }
      if (provider.child.exitCode === null) { provider.child.kill("SIGTERM"); await exit(provider.child); }
    }
  });
});
