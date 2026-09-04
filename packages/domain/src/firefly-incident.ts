import { FireflySignalError, type FireflySignal, type FireflySeverity } from "./firefly.js";
export { deriveFireflyIncidentFingerprint } from "./firefly-identity.js";

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

export type FireflyIncidentKind = "crash" | "vulnerability" | "regression";

/** Initial routing per plan/phase4.md #41: crash/reliability evidence maps to
 * Operations and Engineering; vulnerability evidence maps to Security and
 * Engineering; a user-visible regression may map more broadly. This is the
 * smallest deterministic mapping and is not a substitute for a real Head's
 * own assessment once activated. */
export function routeFireflyIncidentDepartments(kind: FireflyIncidentKind): readonly string[] {
  if (kind === "crash") return ["operations", "engineering"];
  if (kind === "vulnerability") return ["security", "engineering"];
  return ["quality", "engineering"];
}

const MAX_BRIEF_EVIDENCE_ITEMS = 5;

export interface FireflyIncidentSummary {
  readonly incidentFingerprint: string;
  readonly affectedComponent: string;
  readonly affectedVersion: string;
  readonly severity: FireflySeverity;
  readonly confidence: number;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly signalCount: number;
}

export interface FireflyIncidentBrief {
  readonly incidentFingerprint: string;
  readonly affectedComponent: string;
  readonly affectedVersion: string;
  readonly severity: FireflySeverity;
  readonly confidence: number;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly signalCount: number;
  /** Already-redacted evidence from the durable signals, capped so the
   * Brief never becomes an unfiltered raw log dump. */
  readonly boundedEvidence: readonly string[];
  readonly routedDepartments: readonly string[];
}

/** A bounded, redaction-preserving Incident Brief -- never raw log evidence
 * beyond a small capped sample, and never more department routing than the
 * deterministic initial mapping. */
export function buildFireflyIncidentBrief(
  summary: FireflyIncidentSummary,
  evidence: readonly string[],
  kind: FireflyIncidentKind,
): FireflyIncidentBrief {
  if (!Object.hasOwn(severityRank, summary.severity)) throw new FireflySignalError("invalid severity");
  if (!Number.isFinite(summary.confidence) || summary.confidence < 0 || summary.confidence > 1) throw new FireflySignalError("confidence must be between 0 and 1");
  return {
    incidentFingerprint: summary.incidentFingerprint,
    affectedComponent: summary.affectedComponent,
    affectedVersion: summary.affectedVersion,
    severity: summary.severity,
    confidence: summary.confidence,
    firstObservedAt: summary.firstObservedAt,
    lastObservedAt: summary.lastObservedAt,
    signalCount: summary.signalCount,
    boundedEvidence: evidence.slice(0, MAX_BRIEF_EVIDENCE_ITEMS),
    routedDepartments: routeFireflyIncidentDepartments(kind),
  };
}

const IMMEDIATE_SAFE_PAUSE_CONFIDENCE_THRESHOLD = 0.85;

/** A high-confidence critical signal may trigger an automatic safe pause
 * before deliberation. It never triggers remediation by itself. */
export function requiresImmediateSafePause(severity: FireflySeverity, confidence: number): boolean {
  return severity === "critical" && confidence >= IMMEDIATE_SAFE_PAUSE_CONFIDENCE_THRESHOLD;
}

export interface FireflyImprovementEvidence {
  readonly outcome: "resolved" | "false_positive";
  readonly severity: FireflySeverity;
  readonly confidence: number;
  /** Time from the incident's first observation to when it was linked to a
   * remediation Goal (triage start). Null when it closed without ever
   * linking a Goal, for example a direct false positive. */
  readonly detectionToTriageMs: number | null;
  /** Time from triage start to closure. Null under the same condition. */
  readonly triageToCloseMs: number | null;
}

/**
 * Derive bounded improvement-evidence facts from real durable timestamps
 * only. This never triggers a change by itself; it is durable evidence for
 * a later Encore Improvement Digest to consume.
 */
export function computeFireflyImprovementEvidence(
  outcome: "resolved" | "false_positive",
  severity: FireflySeverity,
  confidence: number,
  firstObservedAt: string,
  linkedAt: string | null,
  closedAt: string,
): FireflyImprovementEvidence {
  if (!Object.hasOwn(severityRank, severity)) throw new FireflySignalError("invalid severity");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new FireflySignalError("confidence must be between 0 and 1");
  const firstObserved = Date.parse(firstObservedAt);
  const closed = Date.parse(closedAt);
  if (!Number.isFinite(firstObserved) || !Number.isFinite(closed) || closed < firstObserved) {
    throw new FireflySignalError("improvement evidence timestamps must be valid and ordered");
  }
  if (linkedAt === null) {
    return { outcome, severity, confidence, detectionToTriageMs: null, triageToCloseMs: null };
  }
  const linked = Date.parse(linkedAt);
  if (!Number.isFinite(linked) || linked < firstObserved || closed < linked) {
    throw new FireflySignalError("improvement evidence timestamps must be valid and ordered");
  }
  return {
    outcome,
    severity,
    confidence,
    detectionToTriageMs: linked - firstObserved,
    triageToCloseMs: closed - linked,
  };
}
