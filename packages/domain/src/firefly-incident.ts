import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";
import { assertValidFireflySignal, FireflySignalError, type FireflySignal, type FireflySeverity } from "./firefly.js";

/** The identity input deliberately excludes version: persistence keys incidents by fingerprint plus version. */
export function deriveFireflyIncidentFingerprint(signal: FireflySignal): string {
  assertValidFireflySignal(signal);
  const identity = {
    affectedComponent: normalize(signal.affectedComponent),
    source: normalize(signal.source),
    evidence: signal.minimalReproductionEvidence.map(normalize).filter(Boolean).sort(),
  };
  return createHash("sha256").update(canonicalJson(identity)).digest("hex");
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const severityRank: Record<FireflySeverity, number> = { info: 0, warning: 1, critical: 2 };

export interface FireflySignalScore {
  readonly severity: FireflySeverity;
  readonly confidence: number;
}

/** Aggregate multiple authenticated observations without allowing a weaker observation to hide a stronger one. */
export function scoreFireflySignals(signals: readonly Pick<FireflySignal, "severity" | "confidence">[]): FireflySignalScore {
  if (signals.length === 0) throw new FireflySignalError("at least one Firefly signal is required for scoring");
  let severity: FireflySeverity = "info";
  let confidence = 0;
  for (const signal of signals) {
    if (!Object.hasOwn(severityRank, signal.severity)) throw new FireflySignalError("invalid severity");
    if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) throw new FireflySignalError("confidence must be between 0 and 1");
    if (severityRank[signal.severity] > severityRank[severity]) severity = signal.severity;
    confidence = Math.max(confidence, signal.confidence);
  }
  return { severity, confidence };
}

export interface FireflySilencePolicy {
  readonly maxSilenceMs: number;
}

export interface FireflySilenceAssessment {
  readonly state: "observing" | "uncertain";
  readonly silenceMs: number | null;
  readonly reason: "firefly_observation_silent" | "firefly_observation_missing" | null;
}

/** Silence is watchdog uncertainty. It is never an assertion that no incident exists. */
export function assessFireflySilence(
  lastObservedAt: string | null,
  checkedAt: string,
  policy: FireflySilencePolicy,
): FireflySilenceAssessment {
  if (!Number.isSafeInteger(policy.maxSilenceMs) || policy.maxSilenceMs <= 0) throw new FireflySignalError("maxSilenceMs must be a positive safe integer");
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked)) throw new FireflySignalError("silence check timestamp must be an ISO date");
  if (lastObservedAt === null) return { state: "uncertain", silenceMs: null, reason: "firefly_observation_missing" };
  const last = Date.parse(lastObservedAt);
  if (!Number.isFinite(last) || last > checked) throw new FireflySignalError("last observation must be a valid past ISO date");
  const silenceMs = checked - last;
  return silenceMs > policy.maxSilenceMs
    ? { state: "uncertain", silenceMs, reason: "firefly_observation_silent" }
    : { state: "observing", silenceMs, reason: null };
}
