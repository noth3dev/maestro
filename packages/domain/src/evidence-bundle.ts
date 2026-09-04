import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";

/**
 * The durable evidence bundle for one Goal, per plan/phase3.md's
 * "Evidence bundle" section. Every field is derived from already-durable
 * records; nothing here is computed or claimed independently -- this is an
 * aggregation and hashing layer, not a new source of truth.
 */
export interface EvidenceBundle {
  readonly goalId: string;
  readonly taskContract: Readonly<Record<string, unknown>> | null;
  readonly council: Readonly<Record<string, unknown>> | null;
  readonly departmentPlans: readonly Readonly<Record<string, unknown>>[];
  readonly departmentPlanRevisions: readonly Readonly<Record<string, unknown>>[];
  readonly workers: readonly Readonly<Record<string, unknown>>[];
  readonly gitIntegration: Readonly<Record<string, unknown>>;
  readonly certifications: Readonly<Record<string, unknown>>;
  readonly metronomeFindings: readonly Readonly<Record<string, unknown>>[];
  readonly metronomeChallenges: readonly Readonly<Record<string, unknown>>[];
  readonly encoreRounds: readonly Readonly<Record<string, unknown>>[];
  readonly budgetReservations: readonly Readonly<Record<string, unknown>>[];
  /** Full durable evidence metadata referenced by certification and replay. */
  readonly evidenceRecords: readonly Readonly<Record<string, unknown>>[];
  /** Durable authority decisions and grants/approvals used by the Goal. */
  readonly actualCosts: readonly Readonly<Record<string, unknown>>[];
  readonly authorityRecords: readonly Readonly<Record<string, unknown>>[];
  readonly authorityDecisions: readonly Readonly<Record<string, unknown>>[];
  /** Sealed Council brief material and the activation history that led to it. */
  readonly councilBriefs: readonly Readonly<Record<string, unknown>>[];
  readonly headParticipation: Readonly<{
    participations: readonly Readonly<Record<string, unknown>>[];
    activationAttempts: readonly Readonly<Record<string, unknown>>[];
    activationEdges: readonly Readonly<Record<string, unknown>>[];
  }>;
  readonly assembledAt: string;
}

export function evidenceBundleContentHash(bundle: Omit<EvidenceBundle, "assembledAt">): string {
  return createHash("sha256").update(canonicalJson(bundle)).digest("hex");
}

export class EvidenceBundleIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "EvidenceBundleIntegrityError"; }
}

/** "Evidence artifact hash changes: reject the bundle." Recomputes the canonical hash from the actual stored content and fails closed on any mismatch. */
export function assertEvidenceBundleIntegrity(bundle: Omit<EvidenceBundle, "assembledAt">, expectedHash: string): void {
  const actual = evidenceBundleContentHash(bundle);
  if (actual !== expectedHash.trim()) throw new EvidenceBundleIntegrityError("Evidence bundle content hash does not match its recorded hash");
}
