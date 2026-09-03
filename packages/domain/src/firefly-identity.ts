import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";
import type { FireflySignal } from "./firefly.js";

/** Base signal error. Declared here (a leaf module) so identity/redaction
 * helpers can fail closed with a typed domain error without a circular
 * import back to firefly.ts, which imports these helpers. */
export class FireflySignalError extends Error {}

/** Text that is safe to retain in bounded Firefly evidence and identity facts. */
const REDACTED = "[REDACTED]";
const SECRET_KEY = "(?:access[_ -]?token|api[_ -]?key|apikey|auth[_ -]?token|client[_ -]?secret|credential|password|passwd|private[_ -]?key|refresh[_ -]?token|secret|token)";

/**
 * Redact common credential forms without retaining the credential value.
 * This is intentionally deterministic so a sanitized signal can still be
 * authenticated and fingerprinted across process boundaries.
 */
export function redactFireflySecretLikeText(value: string): string {
  if (typeof value !== "string") throw new FireflySignalError("Firefly evidence text must be a string");
  let safe = value;
  safe = safe.replace(/-----BEGIN(?: [^-]*)? PRIVATE KEY-----[\s\S]*?-----END(?: [^-]*)? PRIVATE KEY-----/gi, REDACTED);
  safe = safe.replace(/((?:\bauthorization\s*:\s*)?\bbearer\s+)[^\s,;&]+/gi, `$1${REDACTED}`);
  safe = safe.replace(new RegExp(String.raw`((["']?${SECRET_KEY}["']?)\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)`, "gi"), `$1${REDACTED}`);
  safe = safe.replace(new RegExp(String.raw`([?&](?:${SECRET_KEY})=)[^&\s]+`, "gi"), `$1${REDACTED}`);
  safe = safe.replace(new RegExp(String.raw`(\b(?:${SECRET_KEY})\b\s+)[^\s,;&]+`, "gi"), `$1${REDACTED}`);
  return safe;
}

/** Apply the same redaction to every free-text signal field before hashing or storage. */
export function sanitizeFireflySignal(signal: FireflySignal): FireflySignal {
  return {
    ...signal,
    affectedComponent: redactFireflySecretLikeText(signal.affectedComponent),
    affectedVersion: redactFireflySecretLikeText(signal.affectedVersion),
    minimalReproductionEvidence: signal.minimalReproductionEvidence.map(redactFireflySecretLikeText),
    source: redactFireflySecretLikeText(signal.source),
  };
}

/** Identity facts exclude mutable severity, confidence, timestamps, and version. */
export function deriveFireflyIncidentFingerprint(
  signal: Pick<FireflySignal, "affectedComponent" | "source" | "minimalReproductionEvidence">,
): string {
  const identity = {
    affectedComponent: normalize(signal.affectedComponent),
    source: normalize(signal.source),
    evidence: signal.minimalReproductionEvidence.map((item) => normalize(redactFireflySecretLikeText(item))).filter(Boolean).sort(),
  };
  return createHash("sha256").update(canonicalJson(identity)).digest("hex");
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
