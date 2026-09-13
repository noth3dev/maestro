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
  readonly input: unknown;
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
}

export type ShadowAuthorityExecutor = Pick<AuthorizedEffectExecutor, "execute">;
export type ShadowKernelPort = Pick<ExecutionKernelPort, "observe" | "getToolEvents" | "getUsage" | "getInvocationStatus">;

export interface ShadowEvaluationRecord {
  readonly input: unknown;
  readonly active: ShadowOutput;
  readonly proposed: ShadowOutput;
  readonly compared: true;
  readonly readEvidenceIds: readonly string[];
}

export interface ShadowEvaluationResult {
  readonly status: "completed" | "interrupted";
  readonly records: readonly ShadowEvaluationRecord[];
  readonly deniedEffects: readonly ShadowEffectRequest[];
  /** Always empty: the boundary has no live-effect write path. */
  readonly liveEffects: readonly [];
}

export interface ShadowEvaluationRequest {
  readonly candidate: ImprovementCandidateInput;
  readonly cases: readonly ShadowCase[];
  readonly evaluate: (input: unknown, context: ShadowExecutionContext) => Promise<ShadowOutput>;
  readonly recordedEvidence?: Readonly<Record<string, unknown>>;
  /** Kept as an explicit composition seam; never called by shadow execution. */
  readonly authorityExecutor?: ShadowAuthorityExecutor;
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

function copyOutput(value: ShadowOutput): ShadowOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidShadowOutputError("shadow output must be an object");
  if (!Array.isArray(value.messages) || value.messages.some((message) => typeof message !== "string")) throw new InvalidShadowOutputError("shadow output messages must be strings");
  if (!Array.isArray(value.plans) || !Array.isArray(value.challenges)) throw new InvalidShadowOutputError("shadow output plans and challenges must be arrays");
  return Object.freeze({
    messages: Object.freeze([...value.messages]),
    plans: Object.freeze([...value.plans]),
    challenges: Object.freeze([...value.challenges]),
  });
}

/**
 * Evaluate a candidate against recorded active outputs without granting any
 * live authority. The evaluator callback is the provider-specific adapter;
 * this boundary owns the denial and comparison rules.
 */
export async function runShadowEvaluation(request: ShadowEvaluationRequest): Promise<ShadowEvaluationResult> {
  assertValidImprovementCandidateInput(request.candidate);
  if (!Array.isArray(request.cases)) throw new InvalidShadowOutputError("shadow cases must be an array");

  const evidence = request.recordedEvidence ?? {};
  const records: ShadowEvaluationRecord[] = [];
  const deniedEffects: ShadowEffectRequest[] = [];

  for (const shadowCase of request.cases) {
    if (request.signal?.aborted) return { status: "interrupted", records, deniedEffects, liveEffects: [] };
    const readEvidenceIds: string[] = [];
    const context: ShadowExecutionContext = {
      readRecordedEvidence: (evidenceId) => {
        if (!Object.hasOwn(evidence, evidenceId)) throw new ShadowEvidenceUnavailableError(evidenceId);
        readEvidenceIds.push(evidenceId);
        return evidence[evidenceId];
      },
      attemptEffect: async (effectRequest) => {
        deniedEffects.push(Object.freeze({ ...effectRequest }));
        throw new ShadowEffectDeniedError();
      },
    };
    const proposed = copyOutput(await request.evaluate(shadowCase.input, context));
    if (request.signal?.aborted) return { status: "interrupted", records, deniedEffects, liveEffects: [] };
    records.push(Object.freeze({
      input: shadowCase.input,
      active: copyOutput(shadowCase.active),
      proposed,
      compared: true,
      readEvidenceIds: Object.freeze([...readEvidenceIds]),
    }));
  }

  return { status: "completed", records: Object.freeze(records), deniedEffects: Object.freeze(deniedEffects), liveEffects: [] };
}
