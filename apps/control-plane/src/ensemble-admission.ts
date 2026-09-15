import { randomUUID } from "node:crypto";
import { assertValidRoutingWorkSnapshot, calculatePressure, classifyPressureBand, getTaskKindRecipe, selectRoutedModel, taskDemandContentHash, RoutingSelectionError, type ExecutionAdmission, type ModelMap, type PressureBandProjection, type RoutingEvidence, type RoutingCandidateRejection, type RouterCandidate, type RoutingWorkSnapshot } from "@maestro/domain";
import { createNativeAdmissionFromRouting, type RoutedNativeAdmissionBase } from "./native-admission.js";
import type { MaestroConfig } from "./config.js";

export type RoutingEvidenceDraft = Omit<RoutingEvidence, "evidenceId" | "admissionBindingRef" | "createdAt"> & {
  readonly evidenceId?: undefined;
  readonly admissionBindingRef?: undefined;
  readonly createdAt?: undefined;
};

export interface EnsembleNativeAdmissionDecision {
  readonly admission: ExecutionAdmission;
  readonly routingEvidence: RoutingEvidenceDraft;
}

export interface EnsembleRoutingShortfall {
  readonly goalRef: string;
  readonly projectRef: string;
  readonly routeRef: string;
  readonly pressure: PressureBandProjection;
  readonly rejected: readonly RoutingCandidateRejection[];
}

export class EnsembleRoutingShortfallError extends Error {
  readonly shortfall: EnsembleRoutingShortfall;
  constructor(message: string, shortfall: EnsembleRoutingShortfall) {
    super(message);
    this.name = "EnsembleRoutingShortfallError";
    this.shortfall = shortfall;
  }
}

export interface EnsembleNativeAdmissionInput {
  readonly snapshot: RoutingWorkSnapshot;
  readonly modelMap: ModelMap;
  readonly candidates: readonly RouterCandidate[];
  readonly routeRef: string;
  readonly base: RoutedNativeAdmissionBase;
}

/**
 * Compose the production ensemble route. This is deliberately separate from
 * the pin helper, but hands its selected identity to the shared admission
 * validator so ensemble cannot weaken candidate/account/Goal checks.
 */
export function createEnsembleNativeAdmission(
  config: MaestroConfig,
  input: EnsembleNativeAdmissionInput,
): EnsembleNativeAdmissionDecision {
  if (config.modelRoutingMode !== "ensemble") throw new Error("Ensemble native admission requires ensemble routing mode");
  if (input.snapshot.projectRef !== input.base.context.projectId) throw new Error("Ensemble routing snapshot project binding mismatch");
  if (input.snapshot.missionBundleRef !== input.base.context.missionBundleId) throw new Error("Ensemble routing snapshot Mission Bundle binding mismatch");
  assertValidRoutingWorkSnapshot(input.snapshot);
  const workInput = input.snapshot.routingWorkInput;
  if (workInput === undefined) throw new Error("Ensemble admission requires explicit WorkCharacter/pressure input");
  const pressureCalculation = calculatePressure(workInput.workCharacter, workInput.explicitHeadUplift);
  let selection;
  try {
    selection = selectRoutedModel({
      mode: "ensemble",
      goalRef: input.snapshot.goalRef,
      approvedModels: input.snapshot.approvedModels,
      taskDemand: input.snapshot.taskDemand,
      modelMap: input.modelMap,
      operationalOverlay: input.snapshot.operationalOverlay,
      candidates: input.candidates,
      pressure: pressureCalculation.pressure,
    });
  } catch (error) {
    if (error instanceof RoutingSelectionError && (error.message.startsWith("No candidate") || error.message === "candidates must be non-empty")) {
      const pressure = classifyPressureBand(pressureCalculation.pressure);
      throw new EnsembleRoutingShortfallError(`Ensemble routing shortfall escalated to ${pressure.decisionLayer}`, {
        goalRef: input.snapshot.goalRef,
        projectRef: input.snapshot.projectRef,
        routeRef: input.routeRef,
        pressure,
        rejected: error.rejected,
      });
    }
    throw error;
  }
  const admission = createNativeAdmissionFromRouting(
    config,
    { ...selection, candidateBindings: selection.candidateRefs.map((candidateRef) => {
      const candidate = input.candidates.find((entry) => entry.candidateRef === candidateRef);
      if (candidate === undefined) throw new Error("Ensemble selection candidate binding is missing");
      return candidate;
    }) },
    input.base,
  );
  const modelProfile = input.modelMap.entries.find((entry) => entry.modelRef === selection.selectedModelRef);
  if (modelProfile === undefined) throw new Error("Ensemble selection model profile is absent");
  return {
    admission,
    routingEvidence: {
      schemaVersion: 1,
      evidenceId: undefined,
      goalRef: selection.goalRef,
      projectRef: input.snapshot.projectRef,
      routeRef: input.routeRef,
      mode: "ensemble",
      selectedModelRef: selection.selectedModelRef,
      accountBinding: selection.accountBinding,
      candidateRefs: selection.candidateRefs,
      selectedCandidateRef: selection.selectedCandidateRef,
      rejections: selection.rejected,
      taskDemandHash: taskDemandContentHash(input.snapshot.taskDemand),
      pressure: selection.pressure.pressure,
      pressureBand: selection.pressure.band,
      decisionLayer: selection.pressure.decisionLayer,
      overlayVersion: input.snapshot.operationalOverlay.overlayVersion,
      admissionBindingRef: undefined,
      rationale: selection.rationale,
      createdAt: undefined,
      pressureCalculation,
      taskKindRecipeVersions: Object.fromEntries(input.snapshot.taskDemand.taskKinds.map((kind) => [kind, getTaskKindRecipe(kind).schemaVersion])),
      taskDemand: input.snapshot.taskDemand,
      workCharacter: workInput.workCharacter,
      modelProfile,
      operationalOverlaySnapshot: input.snapshot.operationalOverlay,
      approvalRef: null,
      approvalIdentity: null,
    },
  };
}

/** Return a stable evidence id at the persistence boundary, never during selection. */
export function newRoutingEvidenceId(): string {
  return randomUUID();
}
