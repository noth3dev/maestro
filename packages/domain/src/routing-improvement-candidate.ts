import {
  assertValidImprovementCandidate,
  assertValidImprovementCandidateInput,
  type ImprovementCandidate,
  type ImprovementCandidateInput,
} from "./improvement-candidate.js";
import { assertValidModelMap } from "./model-map.js";
import { assertValidTaskDemand } from "./task-demand.js";
import { selectRoutedModel, type RoutingSelection, type RoutingSelectionRequest } from "./routing-selector.js";

/** Error raised when a routing proposal would cross the routing judgment boundary. */
export class RoutingImprovementCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingImprovementCandidateError";
  }
}

/**
 * Validate and retain the shared §S2 candidate shape for a routing proposal.
 *
 * Routing candidates deliberately remain the same Improvement Candidate
 * contract as persona candidates. This adapter only checks the routing kind
 * and target; it does not create an alternate score or routing authority.
 */
export function createRoutingCapabilityCandidate(input: ImprovementCandidateInput): ImprovementCandidateInput {
  try {
    assertValidImprovementCandidateInput(input);
  } catch (error) {
    throw new RoutingImprovementCandidateError(error instanceof Error ? error.message : "Routing capability candidate is invalid");
  }
  if (input.kind !== "routing_capability_axis" || input.target.routingTarget === undefined) {
    throw new RoutingImprovementCandidateError("Routing capability candidate must target one provider/model identity");
  }
  return Object.freeze({
    ...input,
    target: Object.freeze({ ...input.target }),
    changes: Object.freeze(input.changes.map((change) => Object.freeze({ ...change }))),
    sourceEvidenceIds: Object.freeze([...input.sourceEvidenceIds]),
    expectedMetrics: Object.freeze(input.expectedMetrics.map((metric) => Object.freeze({ ...metric }))),
    protectedMetrics: Object.freeze(input.protectedMetrics.map((metric) => Object.freeze({ ...metric }))),
    scenarioSuite: Object.freeze([...input.scenarioSuite]),
    dataSufficiency: Object.freeze({ ...input.dataSufficiency }),
    rollbackTarget: Object.freeze({ ...input.rollbackTarget }),
  });
}

/**
 * Route using the human baseline and the immutable C overlay only.
 *
 * A candidate is an evidence-backed proposal. It may be supplied to this
 * boundary only after the shared lifecycle reaches an independent Council
 * judgment. Even then, the candidate never patches `modelMap`: a capability
 * score becomes routable only when a human-owned baseline update is supplied.
 */
export function selectRoutedModelWithRoutingCandidate(
  request: RoutingSelectionRequest,
  candidate: ImprovementCandidate,
): RoutingSelection {
  try {
    assertValidImprovementCandidate(candidate);
  } catch (error) {
    throw new RoutingImprovementCandidateError(error instanceof Error ? error.message : "Routing capability candidate is invalid");
  }
  if (candidate.kind !== "routing_capability_axis" || candidate.target.routingTarget === undefined) {
    throw new RoutingImprovementCandidateError("Routing capability candidate must target a provider/model identity");
  }
  if (candidate.goalId.toLowerCase() !== request.goalRef.toLowerCase()) {
    throw new RoutingImprovementCandidateError("Routing capability candidate is bound to a different Goal");
  }
  if (candidate.state !== "judged" && candidate.state !== "applied" && candidate.state !== "retained") {
    throw new RoutingImprovementCandidateError("Routing capability candidate remains a proposal until independent Council judgment");
  }

  // Validate the routing inputs before checking the target, but never use the
  // candidate to replace any field in the request or to alter the baseline.
  assertValidTaskDemand(request.taskDemand);
  assertValidModelMap(request.modelMap);
  if (!request.approvedModels.includes(candidate.target.routingTarget)) {
    throw new RoutingImprovementCandidateError("Routing capability candidate is outside the approved Mission Bundle models");
  }
  if (!request.modelMap.entries.some((entry) => entry.modelRef === candidate.target.routingTarget)) {
    throw new RoutingImprovementCandidateError("Routing capability candidate target is absent from the human-owned model_map baseline");
  }
  return selectRoutedModel(request);
}
