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
  readonly ceoApproved?: boolean;
  readonly existingRefinementId?: string;
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
  readonly status: "applied" | "observed" | "rolled_back" | "deprecated" | "removed";
  readonly deprecatedAt?: string;
  readonly usageObservedAt?: string;
  readonly observedUnused?: boolean;
}

export interface NativeRefinementObservation {
  readonly regression?: boolean;
}

export interface NativeRefinementUsageObservation {
  readonly used: boolean;
}

export interface NativeRefinementAdapterOptions {
  readonly enabledClasses: readonly ImprovementCandidateKind[];
  /** Optional test/integration hook invoked only after all boundary checks. */
  readonly evaluate?: (request: NativeRefinementRequest) => void;
}

export class NativeRefinementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeRefinementError";
  }
}

function fail(message: string): never { throw new NativeRefinementError(message); }

function cloneCandidate(candidate: ImprovementCandidateInput): ImprovementCandidateInput {
  try {
    const copy = structuredClone(candidate);
    assertValidImprovementCandidateInput(copy);
    return copy;
  } catch (error) {
    fail(error instanceof Error ? error.message : "Improvement Candidate is invalid");
  }
}

function validComponent(value: unknown): value is NativeRefinementComponent {
  return typeof value === "string" && (NATIVE_REFINEMENT_COMPONENTS as readonly string[]).includes(value);
}

function validateEvaluation(value: unknown): asserts value is NativeRefinementEvaluation {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Refinement evaluation is required");
  const evaluation = value as Record<string, unknown>;
  for (const field of ["replayPassed", "syntheticPassed", "shadowPassed", "independentCouncilPassed"] as const) {
    if (evaluation[field] !== true) fail(`Refinement evaluation ${field} must pass`);
  }
  for (const field of ["episodeCount", "comparableGoalCount"] as const) {
    if (!Number.isSafeInteger(evaluation[field]) || (evaluation[field] as number) < 0) fail(`Refinement evaluation ${field} is invalid`);
  }
}

function validateControls(request: NativeRefinementRequest): void {
  // Component is deliberately checked before candidate evaluation and before
  // invoking the optional evaluator, so unsupported controls cannot be probed.
  if (!validComponent(request?.component)) fail("Refinement component is outside the native refinement boundary");
  if (request.scope !== "project" && request.scope !== "global") fail("Refinement scope is invalid");
  const mutation = request.mutation ?? "additive";
  const validMutations: readonly string[] = ["additive", "narrow_reversible", "semantic_reversal", "scope_expansion", "delete"];
  if (!validMutations.includes(mutation)) fail("Refinement mutation is invalid");
  validateEvaluation(request.evaluation);
  if (request.scope === "global" && (request.evaluation.episodeCount < 2 || request.evaluation.comparableGoalCount < 2)) {
    fail("Global refinement requires evidence from multiple episodes and comparable Goals");
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function snapshot(record: NativeRefinementRecord): NativeRefinementRecord {
  return deepFreeze({ ...record, candidate: structuredClone(record.candidate) });
}

export interface NativeRefinementAdapter {
  refine(request: NativeRefinementRequest): NativeRefinementRecord;
  observe(refinementId: string, observation: NativeRefinementObservation): NativeRefinementRecord;
  rollback(refinementId: string): NativeRefinementRecord;
  deprecateGlobal(refinementId: string): NativeRefinementRecord;
  observeGlobal(refinementId: string, observation: NativeRefinementUsageObservation): NativeRefinementRecord;
  removeGlobal(refinementId: string, authorization: { readonly ceoApproved: boolean }): NativeRefinementRecord;
  get(refinementId: string): NativeRefinementRecord | undefined;
  history(refinementId: string): readonly NativeRefinementRecord[];
}

export function createNativeRefinementAdapter(options: NativeRefinementAdapterOptions): NativeRefinementAdapter {
  if (!options || !Array.isArray(options.enabledClasses)) fail("Native refinement enabled classes are required");
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

  function versioned(entry: NativeRefinementRecord, patch: Partial<NativeRefinementRecord>): NativeRefinementRecord {
    return { ...entry, ...patch, version: entry.version + 1 };
  }

  function refine(request: NativeRefinementRequest): NativeRefinementRecord {
    validateControls(request);
    const candidate = cloneCandidate(request.candidate);
    const mutation = request.mutation ?? "additive";
    if (request.scope === "project") {
      try { assertImprovementClassEnabled(candidate.kind, options.enabledClasses); }
      catch (error) { fail(error instanceof Error ? error.message : "Improvement class is not enabled"); }
    }
    const existing = request.existingRefinementId === undefined ? undefined : read(request.existingRefinementId);
    if (mutation === "semantic_reversal" || mutation === "scope_expansion" || mutation === "delete") {
      if (request.scope === "global" && existing === undefined) fail("Global destructive refinement must modify an existing entry");
      if (request.ceoApproved !== true) fail("Global destructive refinement requires explicit CEO approval");
      if (mutation === "delete") fail("Global entries must be deprecated and observed before removal");
    }
    if (existing?.scope === "global" && existing.status !== "applied" && existing.status !== "observed") fail("Only an active global refinement can be modified");
    options.evaluate?.({ ...request, candidate });
    const entry = {
      refinementId: existing?.refinementId ?? randomUUID(),
      version: (existing?.version ?? 0) + 1,
      candidate,
      candidateContentHash: improvementCandidateContentHash(candidate),
      component: request.component,
      scope: request.scope,
      improvementClass: candidate.kind,
      mutation,
      status: "applied" as const,
      ...(existing?.deprecatedAt === undefined ? {} : { deprecatedAt: existing.deprecatedAt }),
      ...(existing?.usageObservedAt === undefined ? {} : { usageObservedAt: existing.usageObservedAt }),
    };
    return save(entry);
  }

  function observe(refinementId: string, observation: NativeRefinementObservation): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.status !== "applied" && entry.status !== "observed") fail("Only an applied refinement can be observed");
    if (observation.regression === true) return save(versioned(entry, { status: "rolled_back" }));
    return save(versioned(entry, { status: "observed" }));
  }

  function rollback(refinementId: string): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.status !== "applied" && entry.status !== "observed") fail("Only an applied refinement can be rolled back");
    return save(versioned(entry, { status: "rolled_back" }));
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

  function removeGlobal(refinementId: string, authorization: { readonly ceoApproved: boolean }): NativeRefinementRecord {
    const entry = read(refinementId);
    if (entry.scope !== "global") fail("Only global refinements can be removed");
    if (entry.deprecatedAt === undefined || entry.usageObservedAt === undefined || entry.status !== "observed") fail("Global refinement must be deprecated and observed before removal");
    if (entry.observedUnused !== true) fail("Global refinement must be observed unused before removal");
    if (authorization?.ceoApproved !== true) fail("Removing a global refinement requires explicit CEO approval");
    return save(versioned(entry, { status: "removed" }));
  }

  return Object.freeze({
    refine,
    observe,
    rollback,
    deprecateGlobal,
    observeGlobal,
    removeGlobal,
    get: (refinementId: string) => entries.get(refinementId),
    history: (refinementId: string) => Object.freeze([...(histories.get(refinementId) ?? [])]),
  });
}
