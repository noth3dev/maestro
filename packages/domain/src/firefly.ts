import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./task-contract.js";

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
export class FireflySignalError extends Error {}
export class FireflyAuthenticationError extends FireflySignalError {}
export class FireflyFreshnessError extends FireflySignalError {}
export class FireflyReplayError extends FireflySignalError {}

function text(v: unknown, field: string): asserts v is string { if (typeof v !== "string" || v.trim() === "") throw new FireflySignalError(`${field} is required`); }
export function assertValidFireflySignal(s: FireflySignal): void {
  for (const [v, f] of [[s.incidentFingerprint,"incidentFingerprint"],[s.firstObservedAt,"firstObservedAt"],[s.lastObservedAt,"lastObservedAt"],[s.affectedComponent,"affectedComponent"],[s.affectedVersion,"affectedVersion"],[s.source,"source"],[s.sourceFreshness,"sourceFreshness"]] as const) text(v,f);
  if (!["info","warning","critical"].includes(s.severity)) throw new FireflySignalError("invalid severity");
  if (!["healthy","degraded","unhealthy"].includes(s.fireflyHealthState)) throw new FireflySignalError("invalid Firefly health state");
  if (!["new","same","related"].includes(s.deduplicationRelationship)) throw new FireflySignalError("invalid deduplication relationship");
  if (!Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) throw new FireflySignalError("confidence must be between 0 and 1");
  if (!Array.isArray(s.minimalReproductionEvidence)) throw new FireflySignalError("reproduction evidence must be an array");
  if (Number.isNaN(Date.parse(s.firstObservedAt)) || Number.isNaN(Date.parse(s.lastObservedAt))) throw new FireflySignalError("observation timestamps must be ISO dates");
}
function unsigned(e: Omit<AuthenticatedFireflySignal, "signature">): string { return canonicalJson(e); }
export function signFireflySignal(signal: FireflySignal, secret: string, nonce: string, sequence: number, issuedAt = new Date().toISOString()): AuthenticatedFireflySignal {
  assertValidFireflySignal(signal); text(secret,"credential"); text(nonce,"nonce"); if (!Number.isSafeInteger(sequence) || sequence < 0) throw new FireflySignalError("sequence must be a nonnegative integer");
  const body = { signal, nonce, sequence, issuedAt }; return { ...body, signature: createHmac("sha256", secret).update(unsigned(body)).digest("hex") };
}
export function verifyFireflySignal(e: AuthenticatedFireflySignal, secret: string, now = Date.now(), freshnessWindowMs = 300_000, replay: FireflyReplayState = { nonces: new Set(), highestSequence: -1 }): FireflyReplayState {
  assertValidFireflySignal(e.signal); text(secret,"credential"); text(e.nonce,"nonce");
  const expected = createHmac("sha256", secret).update(unsigned({ signal:e.signal, nonce:e.nonce, sequence:e.sequence, issuedAt:e.issuedAt })).digest("hex");
  const provided = Buffer.from(e.signature, "hex"); const wanted = Buffer.from(expected, "hex");
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) throw new FireflyAuthenticationError("invalid Firefly signal authentication");
  const issued = Date.parse(e.issuedAt); if (!Number.isFinite(issued) || Math.abs(now - issued) > freshnessWindowMs) throw new FireflyFreshnessError("Firefly signal is outside freshness window");
  if (!Number.isSafeInteger(e.sequence) || e.sequence <= replay.highestSequence || replay.nonces.has(e.nonce)) throw new FireflyReplayError("Firefly signal replay detected");
  return { nonces: new Set([...replay.nonces, e.nonce]), highestSequence: e.sequence };
}
