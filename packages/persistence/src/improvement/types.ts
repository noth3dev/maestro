import { type RoutingCapabilityCouncilJudgment } from "@maestro/domain";
import type { GoalLeaseProof } from "../commands.js";

export class ImprovementCandidatePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImprovementCandidatePersistenceError";
  }
}
export class ImprovementCandidateNotFoundError extends ImprovementCandidatePersistenceError {}

export interface ImprovementCandidateAuthor {
  readonly authorId: string;
  readonly sessionRef: string;
  readonly operatorId: string;
  readonly operatorRoleId: string;
}

/** Durable evidence required to move a routing candidate into the judged state. */
export interface RoutingCandidateJudgmentApproval {
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly councilRoundId: string;
  readonly councilJudgment: RoutingCapabilityCouncilJudgment;
}

export interface RoutingCandidateEvaluationRecord {
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly candidateContentHash: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly scenarioSuiteHash: string;
  readonly evaluationHash: string;
  readonly createdAt: string;
}

export interface ImprovementCandidateReadAuthorization {
  readonly operatorId: string;
  readonly proof: GoalLeaseProof;
}
