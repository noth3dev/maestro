import type { CapabilityGrant, ExecutionAdmission, InvocationContext, RouterCandidate } from "@maestro/domain";
import { parseModelRef } from "@maestro/agent-runtime";
import type { MaestroConfig } from "./config.js";

export type NativeAdmissionInput =
  | {
      purpose: "head";
      goalId: string;
      projectId: string;
      departmentId: string;
      actorId: string;
      sessionRef: string;
      commandId: string;
      fencingToken: string;
    }
  | { purpose: "encore"; goalId: string; projectId: string; commandId: string; reviewerIndex: number; fencingToken: string };

export interface NativeAdmissionSelection {
  readonly goalRef: string;
  readonly mode: "ensemble" | "pin";
  readonly selectedCandidateRef: string;
  readonly selectedModelRef: string;
  readonly accountBinding: string;
  readonly candidateRefs: readonly string[];
  /** Durable candidate identity records captured with the routed decision. */
  readonly candidateBindings: readonly RouterCandidate[];
}

export interface RoutedNativeAdmissionBase {
  readonly context: InvocationContext;
  readonly grant: Omit<CapabilityGrant, "modelPolicy">;
  readonly idempotencyKey: string;
}

/**
 * Project one host-owned routing identity into the native admission shape.
 * This policy boundary never selects a model or widens the grant; the native
 * kernel remains the final model/account identity authority.
 */
export function createNativeAdmissionFromRouting(
  config: MaestroConfig,
  selection: NativeAdmissionSelection,
  base: RoutedNativeAdmissionBase,
): ExecutionAdmission {
  if (selection.mode !== config.modelRoutingMode) throw new Error("Routed admission mode does not match configured routing mode");
  if (selection.mode === "pin" && config.nativeModelRef !== selection.selectedModelRef) {
    throw new Error("Routed admission violates the configured pin identity");
  }
  if (selection.goalRef !== base.context.goalId) throw new Error("Routed admission Goal binding mismatch");
  if (!selection.candidateRefs.includes(selection.selectedCandidateRef))
    throw new Error("Routed admission selected candidate is not in the decision set");
  if (new Set(selection.candidateRefs).size !== selection.candidateRefs.length)
    throw new Error("Routed admission decision set contains a duplicate candidate");
  if (selection.candidateBindings.length !== selection.candidateRefs.length)
    throw new Error("Routed admission candidate bindings do not cover the decision set");
  const candidateBindings = new Map<string, RouterCandidate>();
  for (const candidate of selection.candidateBindings) {
    if (candidateBindings.has(candidate.candidateRef)) throw new Error("Routed admission candidate bindings contain a duplicate candidate");
    candidateBindings.set(candidate.candidateRef, candidate);
  }
  for (const candidateRef of selection.candidateRefs) {
    if (!candidateBindings.has(candidateRef)) throw new Error("Routed admission candidate binding is missing from the decision set");
  }
  const selectedCandidate = candidateBindings.get(selection.selectedCandidateRef);
  if (selectedCandidate === undefined) throw new Error("Routed admission selected candidate binding is missing");
  if (selectedCandidate.modelRef !== selection.selectedModelRef)
    throw new Error("Routed admission selected candidate model binding mismatch");
  if (selectedCandidate.accountBinding !== selection.accountBinding)
    throw new Error("Routed admission selected candidate account binding mismatch");
  const model = parseModelRef(selection.selectedModelRef);
  const accountRef = config.modelAccountRefs[model.provider];
  if (accountRef === undefined) throw new Error(`Routed admission has no account binding for provider: ${model.provider}`);
  if (selection.accountBinding !== accountRef) throw new Error("Routed admission account binding is not host-authorized");
  if (base.context.accountRef !== undefined && base.context.accountRef !== selection.accountBinding)
    throw new Error("Routed admission context account binding mismatch");
  if (Object.hasOwn(base.grant as object, "modelPolicy")) throw new Error("Routed admission base grant cannot carry model policy");
  return {
    context: { ...base.context, accountRef: selection.accountBinding },
    grant: { ...base.grant, modelPolicy: [selection.selectedModelRef] },
    modelPolicy: [selection.selectedModelRef],
    idempotencyKey: base.idempotencyKey,
  };
}

/** Preserve the explicit MAESTRO_NATIVE_MODEL pin path through the same identity boundary. */
export function createPinnedNativeAdmission(config: MaestroConfig, input: NativeAdmissionInput): ExecutionAdmission {
  if (config.nativeModelRef === undefined) throw new Error("Native execution requires MAESTRO_NATIVE_MODEL");
  const model = parseModelRef(config.nativeModelRef);
  const accountRef = config.modelAccountRefs[model.provider];
  if (accountRef === undefined) throw new Error(`Native execution has no account binding for provider: ${model.provider}`);
  const suffix = input.purpose === "head" ? input.departmentId : `reviewer-${input.reviewerIndex}`;
  return createNativeAdmissionFromRouting(
    config,
    {
      goalRef: input.goalId,
      mode: "pin",
      selectedCandidateRef: config.nativeModelRef,
      selectedModelRef: config.nativeModelRef,
      accountBinding: accountRef,
      candidateRefs: [config.nativeModelRef],
      candidateBindings: [{ candidateRef: config.nativeModelRef, modelRef: config.nativeModelRef, accountBinding: accountRef }],
    },
    {
      context: {
        operatorId: input.purpose === "head" ? input.actorId : config.actorId,
        projectId: input.projectId,
        goalId: input.goalId,
        missionBundleId: `native-${input.purpose}`,
        policyVersion: "native-host-v1",
        accountRef,
        fencingToken: input.fencingToken,
      },
      grant: {
        grantId: `native:${input.purpose}:${input.goalId}:${suffix}`,
        allowedTools: [],
        allowedSkills: [],
        pathScope: [config.worktreeRoot],
        outboundDataClasses: ["workspace"],
        remaining: { modelTurns: 8, toolCalls: 0, childCalls: 0, outputTokens: 8_192, wallTimeMs: 120_000, retryCount: 0 },
      },
      idempotencyKey: input.purpose === "encore" ? `${input.commandId}:reviewer:${input.reviewerIndex}` : input.commandId,
    },
  );
}
