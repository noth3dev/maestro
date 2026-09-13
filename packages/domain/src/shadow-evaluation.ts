import type { AuthorizedEffectExecutor } from "@maestro/authority";
import type { ExecutionKernelPort } from "./execution-kernel.js";
import {
  assertValidImprovementCandidateInput,
  type ImprovementCandidateInput,
} from "./improvement-candidate.js";

/** The only output a shadow run may compare with the active result. */
export interface ShadowOutput {
  readonly messages: readonly string[];
  readonly plans: readonly unknown[];
  readonly challenges: readonly unknown[];
}

export interface ShadowCase {
  /** The exact input used for the proposed and active executions. */
  readonly input: unknown;
  /** Durable proof that the active output used the same input. */
  readonly activeInput: unknown;
  readonly active: ShadowOutput;
}

export interface ShadowEffectRequest {
  readonly action: string;
  readonly target: string;
}

/**
 * This is deliberately a smaller surface than either the live kernel or
 * authority gateway. A shadow evaluator can inspect recorded evidence and
 * ask to perform an effect, but cannot receive Goal, budget, or authority
 * state through this context.
 */
export interface ShadowExecutionContext {
  readonly readRecordedEvidence: (evidenceId: string) => unknown;
  readonly attemptEffect: (request: ShadowEffectRequest, effect: () => Promise<unknown>) => Promise<never>;
  /** Optional read-only provider observations; no kernel write method is exposed. */
  readonly kernel?: ShadowKernelPort;
}

export type ShadowAuthorityExecutor = Pick<AuthorizedEffectExecutor, "execute">;
export type ShadowKernelPort = Pick<ExecutionKernelPort, "observe" | "getToolEvents" | "getUsage" | "getInvocationStatus">;

/** Build a facade that cannot invoke a provider write or lifecycle method. */
export function createShadowKernelPort(kernel: ExecutionKernelPort): ShadowKernelPort {
  return Object.freeze({
    observe: kernel.observe.bind(kernel),
    getToolEvents: kernel.getToolEvents.bind(kernel),
    getUsage: kernel.getUsage.bind(kernel),
    getInvocationStatus: kernel.getInvocationStatus.bind(kernel),
  });
}

export interface ShadowAuthorityBoundary {
  readonly attemptEffect: (request: ShadowEffectRequest, effect: () => Promise<unknown>) => Promise<never>;
}

/**
 * Adapt the live gateway into a deny-only shadow boundary. The supplied
 * AuthorizedEffectExecutor is intentionally never called: shadow is not an
 * alternate authority evaluation and can never reach a live effect claim.
 */
async function denyShadowEffect(_request: ShadowEffectRequest, _effect: () => Promise<unknown>): Promise<never> {
  throw new ShadowEffectDeniedError();
}

export function createShadowAuthorityBoundary(_authorityExecutor: ShadowAuthorityExecutor): ShadowAuthorityBoundary {
  return Object.freeze({ attemptEffect: denyShadowEffect });
}

export interface ShadowEvaluationRecord {
  readonly input: unknown;
  readonly active: ShadowOutput;
  readonly proposed: ShadowOutput;
  readonly compared: true;
  readonly matchesActive: boolean;
  readonly readEvidenceIds: readonly string[];
}

export interface ShadowEvaluationResult {
  readonly status: "completed" | "interrupted";
  readonly records: readonly ShadowEvaluationRecord[];
  readonly deniedEffects: readonly ShadowEffectRequest[];
  /** Always empty: the boundary has no live-effect write path. */
  readonly liveEffects: readonly [];
}

export type ShadowJournalEvent =
  | { readonly event: "started"; readonly runId: string }
  | { readonly event: "orphaned"; readonly runId: string; readonly reason: string }
  | { readonly event: "completed"; readonly runId: string; readonly recordCount: number };

/** Adapter seam for the existing append-only process/session journal. */
export interface ShadowLifecycleJournal {
  append(event: ShadowJournalEvent): Promise<void>;
}

export interface ShadowEvaluationRequest {
  readonly candidate: ImprovementCandidateInput;
  readonly cases: readonly ShadowCase[];
  readonly evaluate: (input: unknown, context: ShadowExecutionContext) => Promise<ShadowOutput>;
  readonly recordedEvidence?: Readonly<Record<string, unknown>>;
  /** A journal is required to make interruption/restart observable. */
  readonly journal?: ShadowLifecycleJournal;
  readonly runId?: string;
  /** Read-only provider observations may be supplied by an ExecutionKernel adapter. */
  readonly kernel?: ShadowKernelPort;
  readonly signal?: AbortSignal;
}

export class ShadowEffectDeniedError extends Error {
  constructor() {
    super("Shadow execution has no live authority");
    this.name = "ShadowEffectDeniedError";
  }
}

export class ShadowEvidenceUnavailableError extends Error {
  constructor(evidenceId: string) {
    super(`Recorded shadow evidence is unavailable: ${evidenceId}`);
    this.name = "ShadowEvidenceUnavailableError";
  }
}

export class InvalidShadowOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShadowOutputError";
  }
}

function stableJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidShadowOutputError("shadow values must be finite");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new InvalidShadowOutputError("shadow values must be JSON-compatible");
  if (seen.has(value)) throw new InvalidShadowOutputError("shadow values must not be cyclic");
  seen.add(value);
  try {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry, seen)).join(",")}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key], seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function snapshot<T>(value: T, name: string): T {
  try {
    return deepFreeze(structuredClone(value));
  } catch (error) {
    throw new InvalidShadowOutputError(`${name} must be cloneable JSON data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function copyOutput(value: ShadowOutput): ShadowOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidShadowOutputError("shadow output must be an object");
  if (!Array.isArray(value.messages) || value.messages.some((message) => typeof message !== "string")) throw new InvalidShadowOutputError("shadow output messages must be strings");
  if (!Array.isArray(value.plans) || !Array.isArray(value.challenges)) throw new InvalidShadowOutputError("shadow output plans and challenges must be arrays");
  return snapshot({ messages: [...value.messages], plans: [...value.plans], challenges: [...value.challenges] }, "shadow output");
}

function result(status: ShadowEvaluationResult["status"], records: readonly ShadowEvaluationRecord[], deniedEffects: readonly ShadowEffectRequest[]): ShadowEvaluationResult {
  return Object.freeze({ status, records: Object.freeze([...records]), deniedEffects: Object.freeze([...deniedEffects]), liveEffects: [] as const });
}

async function journalOrphan(request: ShadowEvaluationRequest, reason: string): Promise<void> {
  if (request.journal === undefined || request.runId === undefined) return;
  await request.journal.append({ event: "orphaned", runId: request.runId, reason });
}

/**
 * Evaluate a candidate against recorded active outputs without granting any
 * live authority. The evaluator callback is the provider-specific adapter;
 * this boundary owns the denial, snapshot, lifecycle, and comparison rules.
 */
export async function runShadowEvaluation(request: ShadowEvaluationRequest): Promise<ShadowEvaluationResult> {
  assertValidImprovementCandidateInput(request.candidate);
  if (!Array.isArray(request.cases)) throw new InvalidShadowOutputError("shadow cases must be an array");
  if (request.journal !== undefined && (!request.runId || request.runId.trim() === "")) throw new InvalidShadowOutputError("shadow runId is required when a journal is supplied");

  const evidence = snapshot(request.recordedEvidence ?? {}, "recorded evidence");
  const cases = request.cases.map((shadowCase, index) => {
    if (!shadowCase || typeof shadowCase !== "object") throw new InvalidShadowOutputError(`shadow case ${index} must be an object`);
    const input = snapshot(shadowCase.input, `shadow case ${index} input`);
    const activeInput = snapshot(shadowCase.activeInput, `shadow case ${index} active input`);
    if (stableJson(input) !== stableJson(activeInput)) throw new InvalidShadowOutputError(`shadow case ${index} active and proposed inputs differ`);
    return Object.freeze({ input, activeInput, active: copyOutput(shadowCase.active) });
  });

  if (request.journal !== undefined) await request.journal.append({ event: "started", runId: request.runId! });
  const records: ShadowEvaluationRecord[] = [];
  const deniedEffects: ShadowEffectRequest[] = [];
  for (const shadowCase of cases) {
    if (request.signal?.aborted) {
      await journalOrphan(request, "shadow_run_interrupted_before_case");
      return result("interrupted", records, deniedEffects);
    }
    const readEvidenceIds: string[] = [];
    const context: ShadowExecutionContext = {
      readRecordedEvidence: (evidenceId) => {
        if (!Object.hasOwn(evidence, evidenceId)) throw new ShadowEvidenceUnavailableError(evidenceId);
        readEvidenceIds.push(evidenceId);
        return snapshot(evidence[evidenceId], `recorded evidence ${evidenceId}`);
      },
      attemptEffect: async (effectRequest, effect) => {
        deniedEffects.push(Object.freeze({ ...effectRequest }));
        return await denyShadowEffect(effectRequest, effect);
      },
      ...(request.kernel === undefined ? {} : { kernel: request.kernel }),
    };
    const proposed = copyOutput(await request.evaluate(shadowCase.input, context));
    if (request.signal?.aborted) {
      await journalOrphan(request, "shadow_run_interrupted_after_case");
      return result("interrupted", records, deniedEffects);
    }
    const active = copyOutput(shadowCase.active);
    records.push(Object.freeze({
      input: shadowCase.input,
      active,
      proposed,
      compared: true,
      matchesActive: stableJson(active) === stableJson(proposed),
      readEvidenceIds: Object.freeze([...readEvidenceIds]),
    }));
  }

  const complete = result("completed", records, deniedEffects);
  if (request.journal !== undefined) await request.journal.append({ event: "completed", runId: request.runId!, recordCount: complete.records.length });
  return complete;
}
