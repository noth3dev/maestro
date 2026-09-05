import { randomUUID, X509Certificate } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { deviceIdentityFingerprint, type DeviceEnrollment, type DeviceGrantEnvelope, type DeviceGrantScope, type LocalDevicePolicy } from "@maestro/domain";
import { assertLocallyExecutableDeviceGrant, type LocalDeviceGrantContext, LocalDeviceGrantDeniedError } from "./local.js";
import { DeviceFenceState } from "./fence-state.js";
import type { DeviceFileExecutor } from "./file-executor.js";

export interface DeviceAgentAuthorization {
  readonly enrollment: DeviceEnrollment;
  readonly policy: LocalDevicePolicy;
  readonly scope: DeviceGrantScope;
  readonly goalId: string;
  readonly projectId: string;
  readonly grantId: string;
  readonly deviceId: string;
}

export interface DeviceAgentAuthority {
  loadAuthorization(input: { envelope: DeviceGrantEnvelope; capabilityToken: string; sessionId: string }): Promise<DeviceAgentAuthorization>;
  claimCommand(input: { envelope: DeviceGrantEnvelope; capabilityToken: string; sessionId: string }): Promise<void>;
  recordResult(input: { envelope: DeviceGrantEnvelope; capabilityToken: string; sessionId: string; resultSummary: string; executedAt: string }): Promise<void>;
}

export interface DeviceAgentSessionStore {
  open(input: { sessionId: string; deviceId: string; identityFingerprint: string }): Promise<void>;
  touch(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}

export interface DeviceAgentServerOptions {
  readonly tls: { key: string | Buffer; cert: string | Buffer; ca: string | Buffer };
  readonly deviceId: string;
  readonly identityFingerprint: string;
  readonly issuerKeyId: string;
  readonly issuerPublicKey: string | Buffer;
  readonly fenceState: DeviceFenceState;
  readonly authority: DeviceAgentAuthority;
  readonly sessions: DeviceAgentSessionStore;
  readonly executor: DeviceFileExecutor;
  /** Testable crash-window hook; production leaves this undefined. */
  readonly beforeEffect?: () => Promise<void>;
  readonly maxBodyBytes?: number;
  readonly now?: () => Date;
}

interface Session { sessionId: string; ready: Promise<void>; }

function json(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(encoded), "cache-control": "no-store" });
  response.end(encoded);
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("invalid_json"); }
}

function peerIdentityFingerprint(socket: TLSSocket): string | undefined {
  const peer = socket.getPeerCertificate(true);
  if (!peer || typeof peer.raw !== "object") return undefined;
  try {
    const certificate = new X509Certificate(peer.raw);
    const publicKey = certificate.publicKey.export({ type: "spki", format: "pem" }).toString();
    return deviceIdentityFingerprint(publicKey);
  } catch { return undefined; }
}

function requestSession(request: IncomingMessage): Session | undefined {
  return (request.socket as TLSSocket & { __maestroSession?: Session }).__maestroSession;
}

export function createDeviceAgentServer(options: DeviceAgentServerOptions): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const server = createServer({ ...options.tls, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
    const socket = request.socket as TLSSocket;
    const session = requestSession(request);
    if (session === undefined) return json(response, 401, { error: "device_session_required" });
    try {
      await session.ready;
      if (request.method !== "POST" || request.url !== "/v1/device/commands") return json(response, 404, { error: "not_found" });
      const body = await readBody(request, maxBodyBytes) as { envelope?: unknown; capabilityToken?: unknown };
      if (!body || typeof body !== "object" || !body.envelope || typeof body.capabilityToken !== "string") return json(response, 400, { error: "invalid_command" });
      const envelope = body.envelope as DeviceGrantEnvelope;
      const capabilityToken = body.capabilityToken;
      await options.sessions.touch(session.sessionId);
      const authorization = await options.authority.loadAuthorization({ envelope, capabilityToken, sessionId: session.sessionId });
      const prior = options.fenceState.previous(envelope.grantId);
      const localContext: LocalDeviceGrantContext = {
        enrollment: authorization.enrollment, policy: authorization.policy, scope: authorization.scope,
        expectedGoalId: authorization.goalId, expectedProjectId: authorization.projectId, expectedGrantId: authorization.grantId,
        issuerKeyId: options.issuerKeyId, issuerPublicKey: options.issuerPublicKey,
        previousGoalFencingToken: prior.fence, previousSequence: prior.sequence, now: options.now?.() ?? new Date(),
      };
      assertLocallyExecutableDeviceGrant(envelope, localContext);
      await options.authority.claimCommand({ envelope, capabilityToken, sessionId: session.sessionId });
      await options.fenceState.advance(envelope.grantId, envelope.goalFencingToken, envelope.sequence);
      await options.beforeEffect?.();
      const result = await options.executor.execute(envelope.action, envelope.target);
      await options.authority.recordResult({ envelope, capabilityToken, sessionId: session.sessionId, resultSummary: result.resultSummary, executedAt: (options.now?.() ?? new Date()).toISOString() });
      return json(response, 200, { ok: true, commandId: envelope.commandId, sequence: envelope.sequence, resultSummary: result.resultSummary });
    } catch (error) {
      if (!response.headersSent) {
        if (error instanceof LocalDeviceGrantDeniedError || (error instanceof Error && ["request_too_large", "invalid_json"].includes(error.message))) {
          return json(response, error.message === "request_too_large" ? 413 : 403, { error: error instanceof LocalDeviceGrantDeniedError ? "device_command_denied" : "invalid_command" });
        }
        return json(response, 403, { error: "device_command_denied" });
      }
      response.destroy();
    }
  });

  server.on("secureConnection", (socket) => {
    const identity = peerIdentityFingerprint(socket);
    if (identity === undefined || identity !== options.identityFingerprint) return socket.destroy();
    const sessionId = randomUUID();
    const ready = options.sessions.open({ sessionId, deviceId: options.deviceId, identityFingerprint: identity });
    const session = { sessionId, ready };
    (socket as TLSSocket & { __maestroSession?: Session }).__maestroSession = session;
    socket.once("close", () => { void ready.then(() => options.sessions.close(sessionId), () => undefined); });
  });
  server.on("tlsClientError", (error, socket) => { void error; socket.destroy(); });
  return server;
}
