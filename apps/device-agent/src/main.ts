import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { Pool } from "pg";
import { createBoundedProjectFileReader, createDeviceAgentServer, DeviceFenceState } from "@maestro/device-agent";
import { readDevice } from "@maestro/persistence";
import { claimDeviceAgentCommand, completeDeviceAgentCommand, loadDeviceAgentAuthorization, markUnresolvedDeviceAgentCommandsUnknown } from "@maestro/persistence";
import { closeDeviceAgentSession, openDeviceAgentSession, touchDeviceAgentSession } from "@maestro/persistence";

interface Config {
  databaseUrl: string; host: string; port: number; deviceId: string; identityFingerprint: string; issuerKeyId: string; issuerPublicKey: string;
  keyPath: string; certPath: string; caPath: string; statePath: string; projectRoot: string; maxReadBytes?: number;
}
function config(): Config {
  const raw = process.env.MAESTRO_DEVICE_AGENT_CONFIG;
  if (!raw) throw new Error("MAESTRO_DEVICE_AGENT_CONFIG is required");
  const value = JSON.parse(raw) as Partial<Config>;
  for (const key of ["databaseUrl", "deviceId", "identityFingerprint", "issuerKeyId", "issuerPublicKey", "keyPath", "certPath", "caPath", "statePath", "projectRoot"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "") throw new Error(`device agent config ${key} is required`);
  }
  if (typeof value.host !== "string" || value.host.trim() === "") value.host = "127.0.0.1";
  if (!Number.isSafeInteger(value.port) || (value.port as number) < 0 || (value.port as number) > 65_535) throw new Error("device agent config port is invalid");
  return value as Config;
}

const settings = config();
const pool = new Pool({ connectionString: settings.databaseUrl });
const device = await readDevice(pool, settings.deviceId);
if (device === undefined || device.state !== "enrolled" || device.identityFingerprint !== settings.identityFingerprint) throw new Error("device agent enrollment does not match config");
await markUnresolvedDeviceAgentCommandsUnknown(pool, settings.deviceId);
const fenceState = await DeviceFenceState.open(settings.statePath, settings.deviceId);
const tls = { key: await readFile(settings.keyPath), cert: await readFile(settings.certPath), ca: await readFile(settings.caPath) };
const server = createDeviceAgentServer({
  tls, deviceId: settings.deviceId, identityFingerprint: settings.identityFingerprint, issuerKeyId: settings.issuerKeyId, issuerPublicKey: settings.issuerPublicKey,
  fenceState, executor: createBoundedProjectFileReader(settings.projectRoot, settings.maxReadBytes),
  beforeEffect: async () => {
    const delayMs = Number(process.env.MAESTRO_TEST_DEVICE_BEFORE_EFFECT_DELAY_MS ?? "0");
    if (Number.isFinite(delayMs) && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  },
  sessions: {
    open: ({ sessionId, deviceId, identityFingerprint }) => openDeviceAgentSession(pool, sessionId, deviceId, identityFingerprint).then(() => undefined),
    touch: (sessionId) => touchDeviceAgentSession(pool, sessionId).then(() => undefined),
    close: (sessionId) => closeDeviceAgentSession(pool, sessionId),
  },
  authority: {
    loadAuthorization: (input) => loadDeviceAgentAuthorization(pool, input),
    claimCommand: (input) => claimDeviceAgentCommand(pool, input),
    recordResult: ({ envelope, capabilityToken, sessionId, resultSummary, executedAt }) => completeDeviceAgentCommand(pool, { envelope, capabilityToken, sessionId }, resultSummary, executedAt),
  },
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(settings.port, settings.host, () => resolve()); });
const address = server.address();
if (address === null || typeof address === "string") throw new Error("device agent did not bind a TCP port");
process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
let closing = false;
async function close(): Promise<void> {
  if (closing) return; closing = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
process.once("SIGTERM", () => { void close().then(() => process.exit(0)); });
process.once("SIGINT", () => { void close().then(() => process.exit(0)); });
