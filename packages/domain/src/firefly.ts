import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./task-contract.js";
import {
  FireflySignalError,
  deriveFireflyIncidentFingerprint,
  redactFireflySecretLikeText,
  sanitizeFireflySignal,
} from "./firefly-identity.js";

export type FireflySeverity = "info" | "warning" | "critical";
export type FireflyHealthState = "healthy" | "degraded" | "unhealthy";
export interface FireflySignal {
  readonly incidentFingerprint: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly severity: FireflySeverity;
  readonly confidence: number;
  readonly affectedComponent: string;
  readonly affectedVersion: string;
  readonly minimalReproductionEvidence: readonly string[];
  readonly source: string;
  readonly sourceFreshness: string;
  readonly deduplicationRelationship: "new" | "same" | "related";
  readonly fireflyHealthState: FireflyHealthState;
}
export interface AuthenticatedFireflySignal {
  readonly signal: FireflySignal;
  readonly nonce: string;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly signature: string;
}
export interface FireflyReplayState { readonly nonces: ReadonlySet<string>; readonly highestSequence: number; }
export { FireflySignalError };
export class FireflyAuthenticationError extends FireflySignalError {}
export class FireflyFreshnessError extends FireflySignalError {}
export class FireflyReplayError extends FireflySignalError {}
export class FireflyFingerprintError extends FireflySignalError {}

/** Bounds keep a signed watchdog payload small before it reaches durable storage. */
export const FIREFLY_MAX_EVIDENCE_ITEMS = 16;
export const FIREFLY_MAX_EVIDENCE_ITEM_LENGTH = 4096;
const MAX_IDENTITY_FIELD_LENGTH = 256;
const MAX_TIMESTAMP_LENGTH = 64;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function text(v: unknown, field: string, maxLength = MAX_IDENTITY_FIELD_LENGTH): asserts v is string {
  if (typeof v !== "string" || v.trim() === "") throw new FireflySignalError(`${field} is required`);
  if (v.includes("\0")) throw new FireflySignalError(`${field} contains a NUL character`);
  if (v.length > maxLength) throw new FireflySignalError(`${field} exceeds its size limit`);
}

export function assertValidFireflySignal(s: FireflySignal): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new FireflySignalError("Firefly signal must be an object");
  text(s.incidentFingerprint, "incidentFingerprint");
  if (!FINGERPRINT_PATTERN.test(s.incidentFingerprint)) throw new FireflySignalError("incidentFingerprint must be 64 lowercase hexadecimal characters");
  text(s.firstObservedAt, "firstObservedAt", MAX_TIMESTAMP_LENGTH);
  text(s.lastObservedAt, "lastObservedAt", MAX_TIMESTAMP_LENGTH);
  text(s.affectedComponent, "affectedComponent");
  text(s.affectedVersion, "affectedVersion");
  text(s.source, "source");
  text(s.sourceFreshness, "sourceFreshness", MAX_TIMESTAMP_LENGTH);
  if (!["info", "warning", "critical"].includes(s.severity)) throw new FireflySignalError("invalid severity");
  if (!["healthy", "degraded", "unhealthy"].includes(s.fireflyHealthState)) throw new FireflySignalError("invalid Firefly health state");
  if (!["new", "same", "related"].includes(s.deduplicationRelationship)) throw new FireflySignalError("invalid deduplication relationship");
  if (!Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) throw new FireflySignalError("confidence must be between 0 and 1");
  if (!Array.isArray(s.minimalReproductionEvidence)) throw new FireflySignalError("reproduction evidence must be an array");
  if (s.minimalReproductionEvidence.length > FIREFLY_MAX_EVIDENCE_ITEMS) throw new FireflySignalError("reproduction evidence exceeds its item limit");
  for (const item of s.minimalReproductionEvidence) text(item, "reproduction evidence item", FIREFLY_MAX_EVIDENCE_ITEM_LENGTH);
  const firstObserved = Date.parse(s.firstObservedAt);
  const lastObserved = Date.parse(s.lastObservedAt);
  const sourceFreshness = Date.parse(s.sourceFreshness);
  if (!Number.isFinite(firstObserved) || !Number.isFinite(lastObserved) || !Number.isFinite(sourceFreshness)) throw new FireflySignalError("observation timestamps must be ISO dates");
  if (lastObserved < firstObserved) throw new FireflySignalError("last observation cannot precede first observation");
}

/** Canonicalize untrusted free text and verify that its identity was not caller-selected. */
export function canonicalizeFireflySignal(signal: FireflySignal): FireflySignal {
  assertValidFireflySignal(signal);
  const safe = sanitizeFireflySignal(signal);
  assertValidFireflySignal(safe);
  const expected = deriveFireflyIncidentFingerprint(safe);
  if (safe.incidentFingerprint !== expected) throw new FireflyFingerprintError("Firefly incident fingerprint does not match authenticated signal facts");
  return safe;
}

/** Return the safe signal form used by storage after cryptographic verification. */
export function canonicalizeAuthenticatedFireflySignal(envelope: AuthenticatedFireflySignal): AuthenticatedFireflySignal {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new FireflySignalError("Firefly envelope must be an object");
  return { ...envelope, signal: canonicalizeFireflySignal(envelope.signal) };
}

export { deriveFireflyIncidentFingerprint, redactFireflySecretLikeText, sanitizeFireflySignal };

function unsigned(e: Omit<AuthenticatedFireflySignal, "signature">): string { return canonicalJson(e); }

function assertObservationNotAfterIssued(signal: FireflySignal, issued: number): void {
  const firstObserved = Date.parse(signal.firstObservedAt);
  const lastObserved = Date.parse(signal.lastObservedAt);
  const sourceFreshness = Date.parse(signal.sourceFreshness);
  if (firstObserved > issued || lastObserved > issued || sourceFreshness > issued) {
    throw new FireflyFreshnessError("Firefly observation or source freshness is newer than its issued timestamp");
  }
}

function assertFreshAtReceipt(signal: FireflySignal, issued: number, received: number, freshnessWindowMs: number): void {
  assertObservationNotAfterIssued(signal, issued);
  if (issued > received) throw new FireflyFreshnessError("Firefly signal is issued in the future");
  const lastObserved = Date.parse(signal.lastObservedAt);
  const sourceFreshness = Date.parse(signal.sourceFreshness);
  if (received - lastObserved > freshnessWindowMs || received - sourceFreshness > freshnessWindowMs) {
    throw new FireflyFreshnessError("Firefly observation or source freshness is stale");
  }
}

export function signFireflySignal(signal: FireflySignal, secret: string, nonce: string, sequence: number, issuedAt = new Date().toISOString()): AuthenticatedFireflySignal {
  const safeSignal = canonicalizeFireflySignal(signal);
  text(secret, "credential");
  text(nonce, "nonce");
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new FireflySignalError("sequence must be a nonnegative integer");
  text(issuedAt, "issuedAt", MAX_TIMESTAMP_LENGTH);
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) throw new FireflySignalError("issuedAt must be an ISO date");
  assertObservationNotAfterIssued(safeSignal, issued);
  const body = { signal: safeSignal, nonce, sequence, issuedAt };
  return { ...body, signature: createHmac("sha256", secret).update(unsigned(body)).digest("hex") };
}

export function verifyFireflySignal(e: AuthenticatedFireflySignal, secret: string, now = Date.now(), freshnessWindowMs = 300_000, replay: FireflyReplayState = { nonces: new Set(), highestSequence: -1 }): FireflyReplayState {
  if (!Number.isFinite(now) || !Number.isFinite(freshnessWindowMs) || freshnessWindowMs < 0) throw new FireflySignalError("freshness verification inputs are invalid");
  if (!e || typeof e !== "object" || Array.isArray(e)) throw new FireflySignalError("Firefly envelope must be an object");
  assertValidFireflySignal(e.signal);
  text(secret, "credential");
  text(e.nonce, "nonce");
  if (!Number.isSafeInteger(e.sequence) || e.sequence < 0) throw new FireflyReplayError("Firefly sequence is invalid");
  text(e.issuedAt, "issuedAt", MAX_TIMESTAMP_LENGTH);
  const issued = Date.parse(e.issuedAt);
  if (!Number.isFinite(issued)) throw new FireflyFreshnessError("issuedAt must be an ISO date");
  const safeSignal = sanitizeFireflySignal(e.signal);
  assertValidFireflySignal(safeSignal);
  const expected = createHmac("sha256", secret).update(unsigned({ signal: safeSignal, nonce: e.nonce, sequence: e.sequence, issuedAt: e.issuedAt })).digest("hex");
  if (typeof e.signature !== "string" || !FINGERPRINT_PATTERN.test(e.signature)) throw new FireflyAuthenticationError("invalid Firefly signal authentication");
  const provided = Buffer.from(e.signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) throw new FireflyAuthenticationError("invalid Firefly signal authentication");
  const expectedFingerprint = deriveFireflyIncidentFingerprint(safeSignal);
  if (safeSignal.incidentFingerprint !== expectedFingerprint) throw new FireflyFingerprintError("Firefly incident fingerprint does not match authenticated signal facts");
  assertFreshAtReceipt(safeSignal, issued, now, freshnessWindowMs);
  if (e.sequence <= replay.highestSequence || replay.nonces.has(e.nonce)) throw new FireflyReplayError("Firefly signal replay detected");
  return { nonces: new Set([...replay.nonces, e.nonce]), highestSequence: e.sequence };
}
