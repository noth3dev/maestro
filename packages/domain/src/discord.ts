import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./task-contract.js";
import {
  DiscordSignalError,
  deriveDiscordIncidentFingerprint,
  redactDiscordSecretLikeText,
  sanitizeDiscordSignal,
} from "./discord-identity.js";

export type DiscordSeverity = "info" | "warning" | "critical";
export type DiscordHealthState = "healthy" | "degraded" | "unhealthy";
export interface DiscordSignal {
  readonly incidentFingerprint: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly severity: DiscordSeverity;
  readonly confidence: number;
  readonly affectedComponent: string;
  readonly affectedVersion: string;
  readonly minimalReproductionEvidence: readonly string[];
  readonly source: string;
  readonly sourceFreshness: string;
  readonly deduplicationRelationship: "new" | "same" | "related";
  readonly discordHealthState: DiscordHealthState;
}
export interface AuthenticatedDiscordSignal {
  readonly signal: DiscordSignal;
  readonly nonce: string;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly signature: string;
}
export interface DiscordReplayState { readonly nonces: ReadonlySet<string>; readonly highestSequence: number; }
export { DiscordSignalError };
export class DiscordAuthenticationError extends DiscordSignalError {}
export class DiscordFreshnessError extends DiscordSignalError {}
export class DiscordReplayError extends DiscordSignalError {}
export class DiscordFingerprintError extends DiscordSignalError {}

/** Bounds keep a signed watchdog payload small before it reaches durable storage. */
export const DISCORD_MAX_EVIDENCE_ITEMS = 16;
export const DISCORD_MAX_EVIDENCE_ITEM_LENGTH = 4096;
const MAX_IDENTITY_FIELD_LENGTH = 256;
const MAX_TIMESTAMP_LENGTH = 64;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function text(v: unknown, field: string, maxLength = MAX_IDENTITY_FIELD_LENGTH): asserts v is string {
  if (typeof v !== "string" || v.trim() === "") throw new DiscordSignalError(`${field} is required`);
  if (v.includes("\0")) throw new DiscordSignalError(`${field} contains a NUL character`);
  if (v.length > maxLength) throw new DiscordSignalError(`${field} exceeds its size limit`);
}

export function assertValidDiscordSignal(s: DiscordSignal): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new DiscordSignalError("Discord signal must be an object");
  text(s.incidentFingerprint, "incidentFingerprint");
  if (!FINGERPRINT_PATTERN.test(s.incidentFingerprint)) throw new DiscordSignalError("incidentFingerprint must be 64 lowercase hexadecimal characters");
  text(s.firstObservedAt, "firstObservedAt", MAX_TIMESTAMP_LENGTH);
  text(s.lastObservedAt, "lastObservedAt", MAX_TIMESTAMP_LENGTH);
  text(s.affectedComponent, "affectedComponent");
  text(s.affectedVersion, "affectedVersion");
  text(s.source, "source");
  text(s.sourceFreshness, "sourceFreshness", MAX_TIMESTAMP_LENGTH);
  if (!["info", "warning", "critical"].includes(s.severity)) throw new DiscordSignalError("invalid severity");
  if (!["healthy", "degraded", "unhealthy"].includes(s.discordHealthState)) throw new DiscordSignalError("invalid Discord health state");
  if (!["new", "same", "related"].includes(s.deduplicationRelationship)) throw new DiscordSignalError("invalid deduplication relationship");
  if (!Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) throw new DiscordSignalError("confidence must be between 0 and 1");
  if (!Array.isArray(s.minimalReproductionEvidence)) throw new DiscordSignalError("reproduction evidence must be an array");
  if (s.minimalReproductionEvidence.length > DISCORD_MAX_EVIDENCE_ITEMS) throw new DiscordSignalError("reproduction evidence exceeds its item limit");
  for (const item of s.minimalReproductionEvidence) text(item, "reproduction evidence item", DISCORD_MAX_EVIDENCE_ITEM_LENGTH);
  const firstObserved = Date.parse(s.firstObservedAt);
  const lastObserved = Date.parse(s.lastObservedAt);
  const sourceFreshness = Date.parse(s.sourceFreshness);
  if (!Number.isFinite(firstObserved) || !Number.isFinite(lastObserved) || !Number.isFinite(sourceFreshness)) throw new DiscordSignalError("observation timestamps must be ISO dates");
  if (lastObserved < firstObserved) throw new DiscordSignalError("last observation cannot precede first observation");
}

/** Canonicalize untrusted free text and verify that its identity was not caller-selected. */
export function canonicalizeDiscordSignal(signal: DiscordSignal): DiscordSignal {
  assertValidDiscordSignal(signal);
  const safe = sanitizeDiscordSignal(signal);
  assertValidDiscordSignal(safe);
  const expected = deriveDiscordIncidentFingerprint(safe);
  if (safe.incidentFingerprint !== expected) throw new DiscordFingerprintError("Discord incident fingerprint does not match authenticated signal facts");
  return safe;
}

/** Return the safe signal form used by storage after cryptographic verification. */
export function canonicalizeAuthenticatedDiscordSignal(envelope: AuthenticatedDiscordSignal): AuthenticatedDiscordSignal {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new DiscordSignalError("Discord envelope must be an object");
  return { ...envelope, signal: canonicalizeDiscordSignal(envelope.signal) };
}

export { deriveDiscordIncidentFingerprint, redactDiscordSecretLikeText, sanitizeDiscordSignal };

function unsigned(e: Omit<AuthenticatedDiscordSignal, "signature">): string { return canonicalJson(e); }

function assertObservationNotAfterIssued(signal: DiscordSignal, issued: number): void {
  const firstObserved = Date.parse(signal.firstObservedAt);
  const lastObserved = Date.parse(signal.lastObservedAt);
  const sourceFreshness = Date.parse(signal.sourceFreshness);
  if (firstObserved > issued || lastObserved > issued || sourceFreshness > issued) {
    throw new DiscordFreshnessError("Discord observation or source freshness is newer than its issued timestamp");
  }
}

function assertFreshAtReceipt(signal: DiscordSignal, issued: number, received: number, freshnessWindowMs: number): void {
  assertObservationNotAfterIssued(signal, issued);
  if (issued > received) throw new DiscordFreshnessError("Discord signal is issued in the future");
  const lastObserved = Date.parse(signal.lastObservedAt);
  const sourceFreshness = Date.parse(signal.sourceFreshness);
  if (received - lastObserved > freshnessWindowMs || received - sourceFreshness > freshnessWindowMs) {
    throw new DiscordFreshnessError("Discord observation or source freshness is stale");
  }
}

export function signDiscordSignal(signal: DiscordSignal, secret: string, nonce: string, sequence: number, issuedAt = new Date().toISOString()): AuthenticatedDiscordSignal {
  const safeSignal = canonicalizeDiscordSignal(signal);
  text(secret, "credential");
  text(nonce, "nonce");
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new DiscordSignalError("sequence must be a nonnegative integer");
  text(issuedAt, "issuedAt", MAX_TIMESTAMP_LENGTH);
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) throw new DiscordSignalError("issuedAt must be an ISO date");
  assertObservationNotAfterIssued(safeSignal, issued);
  const body = { signal: safeSignal, nonce, sequence, issuedAt };
  return { ...body, signature: createHmac("sha256", secret).update(unsigned(body)).digest("hex") };
}

export function verifyDiscordSignal(e: AuthenticatedDiscordSignal, secret: string, now = Date.now(), freshnessWindowMs = 300_000, replay: DiscordReplayState = { nonces: new Set(), highestSequence: -1 }): DiscordReplayState {
  if (!Number.isFinite(now) || !Number.isFinite(freshnessWindowMs) || freshnessWindowMs < 0) throw new DiscordSignalError("freshness verification inputs are invalid");
  if (!e || typeof e !== "object" || Array.isArray(e)) throw new DiscordSignalError("Discord envelope must be an object");
  assertValidDiscordSignal(e.signal);
  text(secret, "credential");
  text(e.nonce, "nonce");
  if (!Number.isSafeInteger(e.sequence) || e.sequence < 0) throw new DiscordReplayError("Discord sequence is invalid");
  text(e.issuedAt, "issuedAt", MAX_TIMESTAMP_LENGTH);
  const issued = Date.parse(e.issuedAt);
  if (!Number.isFinite(issued)) throw new DiscordFreshnessError("issuedAt must be an ISO date");
  const safeSignal = sanitizeDiscordSignal(e.signal);
  assertValidDiscordSignal(safeSignal);
  const expected = createHmac("sha256", secret).update(unsigned({ signal: safeSignal, nonce: e.nonce, sequence: e.sequence, issuedAt: e.issuedAt })).digest("hex");
  if (typeof e.signature !== "string" || !FINGERPRINT_PATTERN.test(e.signature)) throw new DiscordAuthenticationError("invalid Discord signal authentication");
  const provided = Buffer.from(e.signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) throw new DiscordAuthenticationError("invalid Discord signal authentication");
  const expectedFingerprint = deriveDiscordIncidentFingerprint(safeSignal);
  if (safeSignal.incidentFingerprint !== expectedFingerprint) throw new DiscordFingerprintError("Discord incident fingerprint does not match authenticated signal facts");
  assertFreshAtReceipt(safeSignal, issued, now, freshnessWindowMs);
  if (e.sequence <= replay.highestSequence || replay.nonces.has(e.nonce)) throw new DiscordReplayError("Discord signal replay detected");
  return { nonces: new Set([...replay.nonces, e.nonce]), highestSequence: e.sequence };
}
