import type { EncoreCouncilResult } from "@maestro/persistence";
import { EncoreCouncilError, runEncoreCouncilReview } from "@maestro/persistence";
import type { ExecutionAdmission, ExecutionKernelPort } from "@maestro/domain";
import type { ImprovementCandidate } from "@maestro/domain";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "@maestro/persistence";

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
  readonly candidate: ImprovementCandidate;
  readonly evaluation: ImprovementCouncilEvaluationDisclosure;
  readonly reviewerCount: number;
}

export interface ImprovementCouncilDisclosure {
  readonly sameModelOnly: boolean;
  readonly reviewerLabel: "same-model-independent-review" | "multi-model-independent-review";
  readonly reviewerModelRefs: readonly string[];
}

export type ImprovementCouncilReviewResult = EncoreCouncilResult & {
  readonly candidateId: string;
  readonly disclosure: ImprovementCouncilDisclosure;
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
    excludedAuthorId: string;
  }) => ExecutionAdmission;
}

export class ImprovementCouncilError extends EncoreCouncilError {
  constructor(message: string) {
    super(message);
    this.name = "ImprovementCouncilError";
  }
}

function assertEvaluation(disclosure: ImprovementCouncilEvaluationDisclosure): void {
  if (!Array.isArray(disclosure.evidenceIds) || disclosure.evidenceIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new ImprovementCouncilError("Improvement Council evaluation evidence must be durable ids");
  }
  for (const [index, result] of disclosure.quantitative.entries()) {
    if (typeof result.metric !== "string" || result.metric.trim() === "") throw new ImprovementCouncilError(`Improvement Council metric ${index} is invalid`);
    if (!Number.isFinite(result.baseline) || !Number.isFinite(result.candidate)) throw new ImprovementCouncilError(`Improvement Council metric ${index} must be finite`);
  }
  if (!Array.isArray(disclosure.qualitative) || disclosure.qualitative.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ImprovementCouncilError("Improvement Council qualitative evidence is invalid");
  }
}

function reviewQuestion(request: ImprovementCouncilReviewRequest): string {
  const { candidate, evaluation } = request;
  return [
    "Review this evaluated improvement candidate independently. Do not treat quantitative improvement as permission to weaken safety, authority, core identity, or diversity boundaries.",
    `Candidate: ${candidate.candidateId} version ${candidate.version} (${candidate.kind})`,
    `Target: ${JSON.stringify(candidate.target)}`,
    `Changes: ${JSON.stringify(candidate.changes)}`,
    `Evidence pattern: ${candidate.evidencePattern}`,
    `Predicted effect: ${candidate.predictedEffect}`,
    `Quantitative evaluation: ${JSON.stringify(evaluation.quantitative)}`,
    `Qualitative evaluation: ${JSON.stringify(evaluation.qualitative)}`,
  ].join("\n");
}

/**
 * Thin improvement-candidate adapter over the already hardened Encore
 * Council. It adds candidate disclosure and author exclusion, while the
 * existing Council owns durable reviewer bindings, isolation, dissent, and
 * same-model synthesis.
 */
export function createImprovementCouncilService(deps: ImprovementCouncilServiceDependencies) {
  return {
    async review(request: ImprovementCouncilReviewRequest, commandId: string): Promise<ImprovementCouncilReviewResult> {
      const { candidate, evaluation } = request;
      assertEvaluation(evaluation);
      const goal = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [candidate.goalId]);
      if (goal.rowCount !== 1) throw new ImprovementCouncilError("Improvement Council candidate Goal was not found");
      if (goal.rows[0]!.project_id !== candidate.projectId) throw new ImprovementCouncilError("Improvement Council candidate project does not match the Goal project");
      if (candidate.authorId.trim() === "") throw new ImprovementCouncilError("Improvement Council candidate author is required");

      return deps.withGoalLease(candidate.goalId, (proof) => runEncoreCouncilReview(deps.pool, deps.kernel, {
        goalId: candidate.goalId,
        proof,
        commandId,
        question: reviewQuestion(request),
        criteria: [
          { criterionId: "candidate-safety", description: "does the candidate preserve correctness, safety, authority, core identity, and diversity hard floors" },
          { criterionId: "candidate-fit", description: "do the fixed evaluation results support the predicted improvement for the declared target" },
          { criterionId: "candidate-disclosure", description: "are reviewer identity, disagreement, conditions, and evidence disclosed honestly" },
        ],
        evidenceIds: [...new Set(evaluation.evidenceIds.map((id) => id.trim()))],
        reviewerCount: request.reviewerCount,
        admission: (reviewerIndex) => {
          const admission = deps.createAdmission({ goalId: candidate.goalId, projectId: candidate.projectId, commandId, reviewerIndex, fencingToken: proof.fencingToken, excludedAuthorId: candidate.authorId });
          if (admission.context.operatorId === candidate.authorId) throw new ImprovementCouncilError("Improvement Council candidate author cannot review its own candidate");
          return admission;
        },
      })).then((result) => {
        const reviewerModelRefs = result.judgments.map((judgment: { modelProvider: string; modelId: string }) => `${judgment.modelProvider}/${judgment.modelId}`);
        const disclosure: ImprovementCouncilDisclosure = {
          sameModelOnly: result.synthesis.sameModelOnly,
          reviewerLabel: result.synthesis.sameModelOnly ? "same-model-independent-review" : "multi-model-independent-review",
          reviewerModelRefs,
        };
        return {
          ...result,
          candidateId: candidate.candidateId,
          disclosure,
          applicationBlocked: result.synthesis.dissentNotes.length > 0 || result.synthesis.finalVerdict !== "proceed",
        };
      });
    },
  };
}
