import type { EncoreCouncilResult, GoalLeaseProof } from "@maestro/persistence";
import { EncoreCouncilError, readImprovementCandidate, runEncoreCouncilReview } from "@maestro/persistence";
import type { ExecutionAdmission, ExecutionKernelPort, ImprovementCandidate } from "@maestro/domain";
import type { Pool } from "pg";

export interface ImprovementCouncilQuantitativeResult {
  readonly metric: string;
  readonly baseline: number;
  readonly candidate: number;
}

export interface ImprovementCouncilEvaluationDisclosure {
  /** Durable evidence records supporting the fixed replay/synthetic/shadow results. */
  readonly evidenceIds: readonly string[];
  readonly quantitative: readonly ImprovementCouncilQuantitativeResult[];
  readonly qualitative: readonly string[];
}

export interface ImprovementCouncilReviewRequest {
  readonly candidateId: string;
  readonly goalId: string;
  readonly projectId: string;
  /** The authenticated operator requesting the review, not the candidate author. */
  readonly operatorId: string;
  readonly reviewerCount: number;
  readonly evaluation: ImprovementCouncilEvaluationDisclosure;
}

export interface ImprovementCouncilDisclosure {
  readonly sameModelOnly: boolean;
  readonly reviewerLabel: "same-model-independent-review" | "multi-model-independent-review";
  readonly reviewerModelRefs: readonly string[];
}

export type ImprovementCouncilReviewResult = EncoreCouncilResult & {
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly disclosure: ImprovementCouncilDisclosure;
  /** S6 must require this gate before any candidate application. */
  readonly applicationBlocked: boolean;
};

export interface ImprovementCouncilServiceDependencies {
  readonly pool: Pool;
  readonly kernel: ExecutionKernelPort;
  readonly withGoalLease: <T>(goalId: string, operation: (proof: GoalLeaseProof) => Promise<T>) => Promise<T>;
  readonly createAdmission: (input: {
    goalId: string;
    projectId: string;
    commandId: string;
    reviewerIndex: number;
    fencingToken: string;
    excludedAuthorOperatorId: string;
  }) => ExecutionAdmission;
}

export class ImprovementCouncilError extends EncoreCouncilError {
  constructor(message: string) {
    super(message);
    this.name = "ImprovementCouncilError";
  }
}

function assertEvaluation(disclosure: ImprovementCouncilEvaluationDisclosure): void {
  if (!disclosure || typeof disclosure !== "object" || Array.isArray(disclosure)) throw new ImprovementCouncilError("Improvement Council evaluation is required");
  if (!Array.isArray(disclosure.evidenceIds) || disclosure.evidenceIds.length === 0 || disclosure.evidenceIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new ImprovementCouncilError("Improvement Council evaluation evidence must be a non-empty list of durable ids");
  }
  if (!Array.isArray(disclosure.quantitative) || !Array.isArray(disclosure.qualitative)) throw new ImprovementCouncilError("Improvement Council evaluation disclosure is malformed");
  const seenMetrics = new Set<string>();
  for (const [index, result] of disclosure.quantitative.entries()) {
    if (!result || typeof result !== "object" || typeof result.metric !== "string" || result.metric.trim() === "" || seenMetrics.has(result.metric)) throw new ImprovementCouncilError(`Improvement Council metric ${index} is invalid`);
    if (!Number.isFinite(result.baseline) || !Number.isFinite(result.candidate)) throw new ImprovementCouncilError(`Improvement Council metric ${index} must be finite`);
    seenMetrics.add(result.metric);
  }
  if (disclosure.qualitative.some((item) => typeof item !== "string" || item.trim() === "")) throw new ImprovementCouncilError("Improvement Council qualitative evidence is invalid");
  if (new Set(disclosure.evidenceIds.map((id) => id.trim())).size !== disclosure.evidenceIds.length) throw new ImprovementCouncilError("Improvement Council evaluation evidence must be unique");
}

function reviewQuestion(candidate: ImprovementCandidate, evaluation: ImprovementCouncilEvaluationDisclosure): string {
  return [
    "Review this evaluated improvement candidate independently. Do not treat quantitative improvement as permission to weaken safety, authority, core identity, or diversity boundaries.",
    `Candidate: ${candidate.candidateId} version ${candidate.version} contentHash ${candidate.contentHash} (${candidate.kind})`,
    `Target: ${JSON.stringify(candidate.target)}`,
    `Changes: ${JSON.stringify(candidate.changes)}`,
    `Source digest evidence ids: ${JSON.stringify(candidate.sourceEvidenceIds)}`,
    `Expected metrics: ${JSON.stringify(candidate.expectedMetrics)}`,
    `Protected metrics: ${JSON.stringify(candidate.protectedMetrics)}`,
    `Scenario suite hash: ${candidate.scenarioSuiteHash}`,
    `Rollback target: ${JSON.stringify(candidate.rollbackTarget)}`,
    `Evidence pattern: ${candidate.evidencePattern}`,
    `Predicted effect: ${candidate.predictedEffect}`,
    `Quantitative evaluation: ${JSON.stringify(evaluation.quantitative)}`,
    `Qualitative evaluation: ${JSON.stringify(evaluation.qualitative)}`,
  ].join("\n");
}

/**
 * Thin improvement-candidate adapter over the already hardened Encore
 * Council. It loads and validates the durable candidate under the caller's
 * Goal lease, excludes its durable author operator before spawn, and leaves
 * reviewer binding, isolation, identity, dissent, and same-model synthesis
 * to the existing Council implementation.
 */
export function createImprovementCouncilService(deps: ImprovementCouncilServiceDependencies) {
  return {
    async review(request: ImprovementCouncilReviewRequest, commandId: string): Promise<ImprovementCouncilReviewResult> {
      assertEvaluation(request.evaluation);
      return deps.withGoalLease(request.goalId, async (proof) => {
        const candidate = await readImprovementCandidate(deps.pool, request.candidateId, { operatorId: request.operatorId, proof });
        if (candidate.goalId !== request.goalId.toLowerCase() || candidate.projectId !== request.projectId.toLowerCase()) throw new ImprovementCouncilError("Improvement Council candidate is outside the requested Goal/project");
        if (candidate.state !== "evaluated") throw new ImprovementCouncilError("Improvement Council requires an evaluated candidate");
        const author = await deps.pool.query<{ author_operator_id: string }>("SELECT author_operator_id FROM improvement_candidates WHERE candidate_id = $1", [candidate.candidateId]);
        if (author.rowCount !== 1 || author.rows[0]!.author_operator_id.trim() === "") throw new ImprovementCouncilError("Improvement Council candidate author identity is missing");
        const excludedAuthorOperatorId = author.rows[0]!.author_operator_id.toLowerCase();
        const result = await runEncoreCouncilReview(deps.pool, deps.kernel, {
          goalId: candidate.goalId,
          proof,
          commandId,
          question: reviewQuestion(candidate, request.evaluation),
          criteria: [
            { criterionId: "candidate-safety", description: "does the candidate preserve correctness, safety, authority, core identity, and diversity hard floors" },
            { criterionId: "candidate-fit", description: "do the fixed evaluation results support the predicted improvement for the declared target" },
            { criterionId: "candidate-disclosure", description: "are reviewer identity, disagreement, conditions, and evidence disclosed honestly" },
          ],
          evidenceIds: [...new Set(request.evaluation.evidenceIds.map((id) => id.trim()))],
          reviewerCount: request.reviewerCount,
          admission: (reviewerIndex) => {
            const admission = deps.createAdmission({ goalId: candidate.goalId, projectId: candidate.projectId, commandId, reviewerIndex, fencingToken: proof.fencingToken, excludedAuthorOperatorId });
            if (admission.context.operatorId.toLowerCase() === excludedAuthorOperatorId) throw new ImprovementCouncilError("Improvement Council candidate author cannot review its own candidate");
            return admission;
          },
        });
        const reviewerModelRefs = result.judgments.map((judgment) => `${judgment.modelProvider}/${judgment.modelId}`);
        const sameModelOnly = result.synthesis.sameModelOnly;
        return {
          ...result,
          candidateId: candidate.candidateId,
          candidateVersion: candidate.version,
          disclosure: { sameModelOnly, reviewerLabel: sameModelOnly ? "same-model-independent-review" : "multi-model-independent-review", reviewerModelRefs },
          applicationBlocked: result.synthesis.dissentNotes.length > 0 || result.synthesis.finalVerdict !== "proceed",
        };
      });
    },
  };
}
