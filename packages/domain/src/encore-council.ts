export type EncoreTriggerReason =
  | "cross_department_material"
  | "unresolved_sentinel_challenge"
  | "high_uncertainty_semantic_review";

export interface EncoreTriggerFacts {
  readonly departmentOwnershipCount: number;
  readonly openChallengeCount: number;
  readonly ambiguousOrUnsupportedReviewCount: number;
}

/** Pure evaluator: the Encore Council is invoked only when one of the plan/phase3.md trigger conditions is actually true, never proactively. */
export function evaluateEncoreTriggers(facts: EncoreTriggerFacts): readonly EncoreTriggerReason[] {
  const reasons: EncoreTriggerReason[] = [];
  if (facts.departmentOwnershipCount > 1) reasons.push("cross_department_material");
  if (facts.openChallengeCount > 0) reasons.push("unresolved_sentinel_challenge");
  if (facts.ambiguousOrUnsupportedReviewCount > 0) reasons.push("high_uncertainty_semantic_review");
  return reasons;
}

export type EncoreVerdict = "proceed" | "do_not_proceed" | "escalate";

export interface EncoreJudgmentSubstance {
  readonly modelProvider: string;
  readonly modelId: string;
  readonly verdict: EncoreVerdict;
  readonly confidence: "low" | "medium" | "high";
  readonly reasoning: string;
  readonly conditions: readonly string[];
  readonly dissentNote: string | null;
  readonly citedEvidenceIds: readonly string[];
}

export class InvalidEncoreJudgmentError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidEncoreJudgmentError"; }
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidEncoreJudgmentError(`${field} is required`);
}

export function assertValidEncoreJudgmentSubstance(value: EncoreJudgmentSubstance): void {
  text(value.modelProvider, "Encore judgment modelProvider");
  text(value.modelId, "Encore judgment modelId");
  if (!["proceed", "do_not_proceed", "escalate"].includes(value.verdict)) throw new InvalidEncoreJudgmentError("Encore judgment verdict is invalid");
  if (!["low", "medium", "high"].includes(value.confidence)) throw new InvalidEncoreJudgmentError("Encore judgment confidence is invalid");
  text(value.reasoning, "Encore judgment reasoning");
}

export interface EncoreSynthesis {
  readonly finalVerdict: EncoreVerdict;
  readonly sameModelOnly: boolean;
  readonly escalated: boolean;
  readonly dissentNotes: readonly string[];
}

/**
 * Produces a synthesis "without deleting minority objections" (every
 * dissent note from every judgment is preserved, never just the majority's).
 * Escalates when uncertainty remains material: any judgment votes
 * "escalate", judgments disagree on the verdict, or a low-confidence
 * judgment coincides with insufficient model diversity (matching
 * "If high consequence or material disagreement combines with low
 * confidence and insufficient diversity, escalate to CEO"). Missing model
 * diversity alone (all judgments genuinely agree, all high confidence) does
 * not stop safe routine work by itself.
 */
export function synthesizeEncoreJudgments(judgments: readonly EncoreJudgmentSubstance[]): EncoreSynthesis {
  if (judgments.length === 0) throw new InvalidEncoreJudgmentError("Encore synthesis requires at least one judgment");
  const dissentNotes = judgments.map((judgment) => judgment.dissentNote).filter((note): note is string => note !== null);
  const distinctModels = new Set(judgments.map((judgment) => `${judgment.modelProvider}/${judgment.modelId}`));
  const sameModelOnly = distinctModels.size <= 1;
  const distinctVerdicts = new Set(judgments.map((judgment) => judgment.verdict));
  const anyEscalateVote = judgments.some((judgment) => judgment.verdict === "escalate");
  const materialDisagreement = distinctVerdicts.size > 1;
  const anyLowConfidence = judgments.some((judgment) => judgment.confidence === "low");
  const escalated = anyEscalateVote || materialDisagreement || (anyLowConfidence && sameModelOnly);
  const finalVerdict: EncoreVerdict = escalated ? "escalate" : judgments[0]!.verdict;
  return { finalVerdict, sameModelOnly, escalated, dissentNotes };
}
