import { randomUUID } from "node:crypto";
import {
  assertImprovementClassEnabled,
  assertValidImprovementCandidateInput,
  improvementCandidateContentHash,
  type ImprovementCandidateInput,
  type ImprovementCandidateKind,
} from "@maestro/domain";

export const NATIVE_REFINEMENT_COMPONENTS = Object.freeze([
  "prompt_guidance",
  "scoped_memory",
  "reusable_skill",
  "head_specification",
  "worker_template",
  "behavioral_policy",
] as const);
export type NativeRefinementComponent = (typeof NATIVE_REFINEMENT_COMPONENTS)[number];
export type NativeRefinementScope = "project" | "global";
export type NativeRefinementMutation = "additive" | "narrow_reversible" | "semantic_reversal" | "scope_expansion" | "delete";

export interface NativeRefinementEvaluation {
  readonly replayPassed: boolean;
  readonly syntheticPassed: boolean;
  readonly shadowPassed: boolean;
  readonly independentCouncilPassed: boolean;
  readonly episodeCount: number;
  readonly comparableGoalCount: number;
  /** Durable evidence IDs used by the fixed evaluation. */
  readonly evidenceIds: readonly string[];
  /** Distinct episode identities resolved from the durable evidence. */
  readonly episodeIds: readonly string[];
}

/**
 * The candidate is the shared Plan-6 ImprovementCandidateInput. The surrounding
 * fields are refinement controls, not a second candidate/proposal schema.
 * `evidencePattern`, `predictedEffect`, `sourceEvidenceIds`, and
 * `rollbackTarget` respectively name the observed problem, expected benefit,
 * evaluation evidence, and rollback target.
 */
export interface NativeRefinementRequest {
  readonly candidate: ImprovementCandidateInput;
  readonly component: NativeRefinementComponent;
  readonly scope: NativeRefinementScope;
  readonly evaluation: NativeRefinementEvaluation;
  readonly mutation?: NativeRefinementMutation;
  readonly ceoApproval?: NativeRefinementCeoApproval;
  readonly existingRefinementId?: string;
}

/** An authenticated approval record bound to the exact proposed change. */
export interface NativeRefinementCeoApproval {
  readonly approvalId: string;
  readonly candidateContentHash: string;
  readonly component: NativeRefinementComponent;
  readonly scope: NativeRefinementScope;
  readonly mutation: NativeRefinementMutation;
  readonly existingRefinementId: string;
}

export interface NativeRefinementRolloutScope {
  readonly scope: NativeRefinementScope;
  readonly projectId: string;
  readonly improvementClass: ImprovementCandidateKind;
  readonly component: NativeRefinementComponent;
}

export interface NativeRefinementRollbackTrigger {
  readonly protectedMetrics: ImprovementCandidateInput["protectedMetrics"];
  readonly rollbackTarget: ImprovementCandidateInput["rollbackTarget"];
}

export interface NativeRefinementRecord {
  readonly refinementId: string;
  readonly version: number;
  readonly candidate: ImprovementCandidateInput;
  readonly candidateContentHash: string;
  readonly component: NativeRefinementComponent;
  readonly scope: NativeRefinementScope;
  readonly improvementClass: ImprovementCandidateKind;
  readonly mutation: NativeRefinementMutation;
  readonly evaluation: NativeRefinementEvaluation;
  readonly rolloutScope: NativeRefinementRolloutScope;
  readonly rollbackTrigger: NativeRefinementRollbackTrigger;
  readonly previousCandidate?: ImprovementCandidateInput;
  readonly status: "applied" | "observed" | "rolled_back" | "deprecated" | "removed";
  readonly deprecatedAt?: string;
  readonly usageObservedAt?: string;
  readonly observedUnused?: boolean;
}

export interface NativeRefinementObservation { readonly regression?: boolean }
export interface NativeRefinementUsageObservation { readonly used: boolean }

export interface NativeRefinementAdapterOptions {
  readonly enabledClasses: readonly ImprovementCandidateKind[];
  /** Optional test/integration hook invoked only after all boundary checks. */
  readonly evaluate?: (request: NativeRefinementRequest) => void;
  /** Resolves durable evidence and independently verifies its episode identities. */
  readonly verifyGlobalEvidence?: (candidate: ImprovementCandidateInput, evaluation: NativeRefinementEvaluation) => boolean;
  /** Classifies an existing entry against its immutable old/new snapshots. */
  readonly classifyMutation?: (previous: NativeRefinementRecord, nextCandidate: ImprovementCandidateInput, nextComponent: NativeRefinementComponent, requestedMutation?: NativeRefinementMutation) => NativeRefinementMutation;
  /** Verifies an authenticated approval record, already bound to exact content. */
  readonly verifyCeoApproval?: (approval: NativeRefinementCeoApproval, candidate: ImprovementCandidateInput, previous?: NativeRefinementRecord) => boolean;
  /** Restores the exact durable rollback target. Returning false fails closed. */
  readonly restoreRollbackTarget?: (target: ImprovementCandidateInput["rollbackTarget"], record: NativeRefinementRecord) => boolean | void;
}

export class NativeRefinementError extends Error {
  constructor(message: string) { super(message); this.name = "NativeRefinementError"; }
}
function fail(message: string): never { throw new NativeRefinementError(message); }

const REQUEST_FIELDS = ["candidate", "component", "scope", "evaluation", "mutation", "ceoApproval", "existingRefinementId"] as const;
const EVALUATION_FIELDS = ["replayPassed", "syntheticPassed", "shadowPassed", "independentCouncilPassed", "episodeCount", "comparableGoalCount", "evidenceIds", "episodeIds"] as const;
const MUTATIONS: readonly NativeRefinementMutation[] = ["additive", "narrow_reversible", "semantic_reversal", "scope_expansion", "delete"];

function strictKeys(value: unknown, allowed: readonly string[], name: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} is required`);
  for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || !allowed.includes(key)) fail(`${name} has unsupported field ${String(key)}`);
}

function cloneCandidate(candidate: ImprovementCandidateInput): ImprovementCandidateInput {
  try {
    const copy = structuredClone(candidate);
    assertValidImprovementCandidateInput(copy);
    return copy;
  } catch (error) { fail(error instanceof Error ? error.message : "Improvement Candidate is invalid"); }
}

function validComponent(value: unknown): value is NativeRefinementComponent {
  return typeof value === "string" && (NATIVE_REFINEMENT_COMPONENTS as readonly string[]).includes(value);
}

function validMutation(value: unknown): value is NativeRefinementMutation { return typeof value === "string" && MUTATIONS.includes(value as NativeRefinementMutation); }

function nonEmptyStrings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) fail(`${field} must be a non-empty string array`);
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) fail(`${field} must contain distinct identities`);
  return normalized;
}

function validateEvaluation(value: unknown): asserts value is NativeRefinementEvaluation {
  strictKeys(value, EVALUATION_FIELDS, "Refinement evaluation");
  const evaluation = value as Record<string, unknown>;
  for (const field of ["replayPassed", "syntheticPassed", "shadowPassed", "independentCouncilPassed"] as const) if (evaluation[field] !== true) fail(`Refinement evaluation ${field} must pass`);
  for (const field of ["episodeCount", "comparableGoalCount"] as const) if (!Number.isSafeInteger(evaluation[field]) || (evaluation[field] as number) < 0) fail(`Refinement evaluation ${field} is invalid`);
  nonEmptyStrings(evaluation.evidenceIds, "Refinement evaluation evidenceIds");
  nonEmptyStrings(evaluation.episodeIds, "Refinement evaluation episodeIds");
}

function validateRequestShape(request: NativeRefinementRequest): void {
  strictKeys(request, REQUEST_FIELDS, "Refinement request");
  if (!validComponent(request.component)) fail("Refinement component is outside the native refinement boundary");
  if (request.scope !== "project" && request.scope !== "global") fail("Refinement scope is invalid");
  if (request.mutation !== undefined && !validMutation(request.mutation)) fail("Refinement mutation is invalid");
  validateEvaluation(request.evaluation);
}

function verifyGlobalEvidence(candidate: ImprovementCandidateInput, evaluation: NativeRefinementEvaluation, verifier: NativeRefinementAdapterOptions["verifyGlobalEvidence"]): void {
  if (candidate.dataSufficiency.episodeCount !== evaluation.episodeCount || candidate.dataSufficiency.comparableGoalCount !== evaluation.comparableGoalCount) fail("Global refinement evidence counts do not match the candidate data sufficiency");
  const candidateEvidence = [...candidate.sourceEvidenceIds].sort();
  const evaluationEvidence = [...evaluation.evidenceIds].sort();
  if (candidateEvidence.length !== evaluationEvidence.length || candidateEvidence.some((id, index) => id !== evaluationEvidence[index])) fail("Global refinement evidence is not bound to the candidate's durable source evidence");
  if (evaluation.episodeCount < 2 || evaluation.comparableGoalCount < 2 || evaluation.episodeIds.length < evaluation.comparableGoalCount) fail("Global refinement requires distinct evidence from multiple comparable episodes");
  if (verifier === undefined || verifier(candidate, evaluation) !== true) fail("Global refinement requires independently verified durable episode evidence");
}

function validateApproval(approval: NativeRefinementCeoApproval | undefined, candidate: ImprovementCandidateInput, component: NativeRefinementComponent, scope: NativeRefinementScope, mutation: NativeRefinementMutation, existingRefinementId: string | undefined, verifier: NativeRefinementAdapterOptions["verifyCeoApproval"], previous: NativeRefinementRecord | undefined): void {
  if (approval === undefined) fail("Explicit CEO approval is required for this global refinement");
  strictKeys(approval, ["approvalId", "candidateContentHash", "component", "scope", "mutation", "existingRefinementId"] as const, "CEO approval");
  if (typeof approval.approvalId !== "string" || approval.approvalId.trim() === "" || approval.candidateContentHash !== improvementCandidateContentHash(candidate)
      || approval.component !== component || approval.scope !== scope || approval.mutation !== mutation || approval.existingRefinementId !== existingRefinementId) fail("CEO approval is not bound to the exact refinement content and scope");
  if (verifier === undefined || verifier(approval, candidate, previous) !== true) fail("CEO approval record is not authenticated");
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function snapshot(record: NativeRefinementRecord): NativeRefinementRecord { return deepFreeze(structuredClone(record)); }

export interface NativeRefinementAdapter {
  refine(request: NativeRefinementRequest): NativeRefinementRecord;
  observe(refinementId: string, observation: NativeRefinementObservation): NativeRefinementRecord;
  rollback(refinementId: string): NativeRefinementRecord;
  deprecateGlobal(refinementId: string): NativeRefinementRecord;
  observeGlobal(refinementId: string, observation: NativeRefinementUsageObservation): NativeRefinementRecord;
  removeGlobal(refinementId: string, authorization: NativeRefinementCeoApproval): NativeRefinementRecord;
  get(refinementId: string): NativeRefinementRecord | undefined;
  history(refinementId: string): readonly NativeRefinementRecord[];
}

export function createNativeRefinementAdapter(options: NativeRefinementAdapterOptions): NativeRefinementAdapter {
  if (!options || !Array.isArray(options.enabledClasses)) fail("Native refinement enabled classes are required");
  const enabledClasses = Object.freeze([...options.enabledClasses]);
  const entries = new Map<string, NativeRefinementRecord>();
  const histories = new Map<string, NativeRefinementRecord[]>();

  function read(refinementId: string): NativeRefinementRecord {
    if (typeof refinementId !== "string" || refinementId.trim() === "") fail("Refinement id is required");
    const entry = entries.get(refinementId);
    if (entry === undefined) fail(`Refinement not found: ${refinementId}`);
    return entry;
  }
  function save(entry: NativeRefinementRecord): NativeRefinementRecord {
    const frozen = snapshot(entry);
    entries.set(frozen.refinementId, frozen);
    histories.set(frozen.refinementId, [...(histories.get(frozen.refinementId) ?? []), frozen]);
    return frozen;
  }
  function versioned(entry: NativeRefinementRecord, patch: Partial<NativeRefinementRecord>): NativeRefinementRecord { return { ...entry, ...patch, version: entry.version + 1 }; }

  function refine(request: NativeRefinementRequest): NativeRefinementRecord {
    validateRequestShape(request);
    const candidate = deepFreeze(cloneCandidate(request.candidate));
    const evaluation = deepFreeze(structuredClone(request.evaluation));
    if (request.scope === "global") verifyGlobalEvidence(candidate, evaluation, options.verifyGlobalEvidence);
    else {
      try { assertImprovementClassEnabled(candidate.kind, enabledClasses); }
      catch (error) { fail(error instanceof Error ? error.message : "Improvement class is not enabled"); }
    }
    const existing = request.existingRefinementId === undefined ? undefined : read(request.existingRefinementId);
    if (existing !== undefined) {
      if (existing.candidate.projectId !== candidate.projectId) fail("Refinement project identity cannot change");
      if (existing.status !== "applied" && existing.status !== "observed") fail("Only an active refinement can be modified");
      const target = candidate.rollbackTarget;
      if (target.candidateId !== existing.refinementId || target.version !== existing.version || target.contentHash !== existing.candidateContentHash) fail("Revision rollback target must bind to the immutable predecessor");
    }
    const contentHash = improvementCandidateContentHash(candidate);
    let mutation: NativeRefinementMutation;
    if (existing === undefined) mutation = request.mutation ?? "additive";
    else {
      const computed = request.scope !== existing.scope ? "scope_expansion" : request.component !== existing.component ? "scope_expansion" : options.classifyMutation?.(existing, candidate, request.component, request.mutation) ?? (contentHash === existing.candidateContentHash ? "narrow_reversible" : "semantic_reversal");
      if (request.mutation !== undefined && request.mutation !== computed) fail("Requested refinement mutation does not match the independently classified old/new snapshots");
      mutation = computed;
    }
    if (!validMutation(mutation)) fail("Refinement mutation is invalid");
    if (request.scope === "global" && (mutation === "semantic_reversal" || mutation === "scope_expansion" || mutation === "delete")) {
      if (existing === undefined) fail("Global destructive refinement must modify an existing entry");
      validateApproval(request.ceoApproval, candidate, request.component, request.scope, mutation, existing.refinementId, options.verifyCeoApproval, existing);
      if (mutation === "delete") fail("Global entries must be deprecated and observed before removal");
    }
    const safeRequest = Object.freeze({ ...request, candidate, evaluation, mutation });
    options.evaluate?.(safeRequest);
    const checkedCandidate = cloneCandidate(candidate);
    if (improvementCandidateContentHash(checkedCandidate) !== contentHash) fail("Refinement candidate changed during evaluation");
    const entry: NativeRefinementRecord = {
      refinementId: existing?.refinementId ?? randomUUID(),
      version: (existing?.version ?? 0) + 1,
      candidate,
      candidateContentHash: contentHash,
      component: request.component,
      scope: request.scope,
      improvementClass: candidate.kind,
      mutation,
      evaluation,
      rolloutScope: { scope: request.scope, projectId: candidate.projectId, improvementClass: candidate.kind, component: request.component },
      rollbackTrigger: { protectedMetrics: candidate.protectedMetrics, rollbackTarget: candidate.rollbackTarget },
      ...(existing === undefined ? {} : { previousCandidate: existing.candidate }),
      status: "applied",
      ...(existing?.deprecatedAt === undefined ? {} : { deprecatedAt: existing.deprecatedAt }),
      ...(existing?.usageObservedAt === undefined ? {} : { usageObservedAt: existing.usageObservedAt }),
    };
    return save(entry);
  }

  function rollback(refinementId: string): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.status !== "applied" && entry.status !== "observed") fail("Only an applied refinement can be rolled back");
    if (options.restoreRollbackTarget === undefined || options.restoreRollbackTarget(entry.rollbackTrigger.rollbackTarget, entry) === false) fail("Refinement rollback could not restore its exact prior target");
    return save(versioned(entry, { status: "rolled_back" }));
  }
  function observe(refinementId: string, observation: NativeRefinementObservation): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.status !== "applied" && entry.status !== "observed") fail("Only an applied refinement can be observed");
    return observation.regression === true ? rollback(refinementId) : save(versioned(entry, { status: "observed" }));
  }
  function deprecateGlobal(refinementId: string): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.scope !== "global") fail("Only global refinements can be deprecated");
    if (entry.status !== "applied" && entry.status !== "observed") fail("Global refinement is not active");
    return save(versioned(entry, { status: "deprecated", deprecatedAt: new Date().toISOString() }));
  }
  function observeGlobal(refinementId: string, observation: NativeRefinementUsageObservation): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.scope !== "global" || entry.deprecatedAt === undefined || entry.status !== "deprecated") fail("Global refinement must be deprecated before usage observation");
    return save(versioned(entry, { status: "observed", usageObservedAt: new Date().toISOString(), observedUnused: observation.used === false }));
  }
  function removeGlobal(refinementId: string, authorization: NativeRefinementCeoApproval): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.scope !== "global") fail("Only global refinements can be removed");
    if (entry.deprecatedAt === undefined || entry.usageObservedAt === undefined || entry.status !== "observed" || entry.observedUnused !== true) fail("Global refinement must be deprecated and observed unused before removal");
    validateApproval(authorization, entry.candidate, entry.component, entry.scope, "delete", entry.refinementId, options.verifyCeoApproval, entry);
    return save(versioned(entry, { status: "removed" }));
  }
  return Object.freeze({
    refine, observe, rollback, deprecateGlobal, observeGlobal, removeGlobal,
    get: (refinementId: string) => entries.get(refinementId),
    history: (refinementId: string) => Object.freeze([...(histories.get(refinementId) ?? [])]),
  });
}
