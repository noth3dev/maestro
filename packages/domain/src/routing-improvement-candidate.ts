import {
  assertValidImprovementCandidate,
  assertValidImprovementCandidateInput,
  type ImprovementCandidate,
  type ImprovementCandidateInput,
} from "./improvement-candidate.js";
import { assertValidModelMap } from "./model-map.js";
import { assertValidEncoreJudgmentSubstance, synthesizeEncoreJudgments, type EncoreJudgmentSubstance } from "./encore-council.js";
import { assertValidTaskDemand } from "./task-demand.js";
import { selectRoutedModel, type RoutingSelection, type RoutingSelectionRequest } from "./routing-selector.js";

/** Error raised when a routing proposal would cross the routing judgment boundary. */
export class RoutingImprovementCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingImprovementCandidateError";
  }
}

/** Durable projection of an independent Encore Council judgment. */
export interface RoutingCapabilityCouncilJudgment {
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly candidateContentHash: string;
  readonly councilRoundId: string;
  readonly evidenceIds: readonly string[];
  readonly judgments: readonly EncoreJudgmentSubstance[];
}

function plainRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new RoutingImprovementCandidateError(`${name} must be a plain object`);
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value))
    throw new RoutingImprovementCandidateError(`${field} is invalid`);
}

function assertCouncilJudgment(candidate: ImprovementCandidate, judgment: RoutingCapabilityCouncilJudgment): void {
  plainRecord(judgment, "Routing capability Council judgment");
  const allowed = ["candidateId", "candidateVersion", "candidateContentHash", "councilRoundId", "evidenceIds", "judgments"];
  for (const key of Reflect.ownKeys(judgment)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw new RoutingImprovementCandidateError("Routing capability Council judgment has an unknown field");
  }
  for (const key of allowed) if (!Object.hasOwn(judgment, key)) throw new RoutingImprovementCandidateError(`Routing capability Council judgment field ${key} is required`);
  line(judgment.candidateId, "Routing capability Council judgment candidateId");
  line(judgment.candidateContentHash, "Routing capability Council judgment candidateContentHash");
  if (!/^[a-f0-9]{64}$/.test(judgment.candidateContentHash)) throw new RoutingImprovementCandidateError("Routing capability Council judgment content hash is invalid");
  line(judgment.councilRoundId, "Routing capability Council judgment councilRoundId");
  if (!Array.isArray(judgment.judgments) || judgment.judgments.length < 2) throw new RoutingImprovementCandidateError("Routing capability Council judgment requires independent reviewers");
  for (const reviewer of judgment.judgments) {
    try { assertValidEncoreJudgmentSubstance(reviewer); }
    catch (error) { throw new RoutingImprovementCandidateError(error instanceof Error ? error.message : "Routing capability reviewer judgment is invalid"); }
  }
  const synthesis = synthesizeEncoreJudgments(judgment.judgments);
  const modelRefs = new Set(judgment.judgments.map((reviewer) => `${reviewer.modelProvider}/${reviewer.modelId}`));
  if (synthesis.finalVerdict !== "proceed" || synthesis.escalated || modelRefs.size < 2)
    throw new RoutingImprovementCandidateError("Routing capability Council judgment requires a non-escalated diverse approval");
  if (!Number.isSafeInteger(judgment.candidateVersion) || judgment.candidateVersion < 1 || judgment.candidateId.toLowerCase() !== candidate.candidateId.toLowerCase() || judgment.candidateVersion !== candidate.version || judgment.candidateContentHash !== candidate.contentHash)
    throw new RoutingImprovementCandidateError("Routing capability Council judgment is not bound to the exact candidate version");
  if (!Array.isArray(judgment.evidenceIds) || judgment.evidenceIds.length === 0 || judgment.evidenceIds.some((id) => typeof id !== "string" || id.trim() === ""))
    throw new RoutingImprovementCandidateError("Routing capability Council judgment requires durable evidence references");
  if (!candidate.sourceEvidenceIds.every((id) => judgment.evidenceIds.includes(id)))
    throw new RoutingImprovementCandidateError("Routing capability Council judgment does not cover candidate source evidence");
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
  judgment: RoutingCapabilityCouncilJudgment,
): RoutingSelection {
  try {
    assertValidImprovementCandidate(candidate);
  } catch (error) {
    throw new RoutingImprovementCandidateError(error instanceof Error ? error.message : "Routing capability candidate is invalid");
  }
  if (candidate.kind !== "routing_capability_axis" || candidate.target.routingTarget === undefined) {
    throw new RoutingImprovementCandidateError("Routing capability candidate must target a provider/model identity");
  }
  if (typeof request?.goalRef !== "string" || request.goalRef.trim() === "")
    throw new RoutingImprovementCandidateError("Routing selection request must have a Goal reference");
  if (candidate.goalId.toLowerCase() !== request.goalRef.toLowerCase()) {
    throw new RoutingImprovementCandidateError("Routing capability candidate is bound to a different Goal");
  }
  if (candidate.state !== "judged") {
    throw new RoutingImprovementCandidateError("Routing capability candidate remains a proposal until independent Council judgment");
  }
  if (candidate.dataSufficiency.episodeCount < 2 || candidate.dataSufficiency.comparableGoalCount < 2) {
    throw new RoutingImprovementCandidateError("Routing capability judgment requires repeated comparable evidence, not a single execution");
  }
  assertCouncilJudgment(candidate, judgment);

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
