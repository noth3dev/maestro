export type OverwatchTriggerReason =
  | "cross_department_material"
  | "unresolved_sentinel_challenge"
  | "high_uncertainty_semantic_review";

export interface OverwatchTriggerFacts {
  readonly departmentOwnershipCount: number;
  readonly openChallengeCount: number;
  readonly ambiguousOrUnsupportedReviewCount: number;
}

/** Pure evaluator: the Overwatch Council is invoked only when one of the plan/phase3.md trigger conditions is actually true, never proactively. */
export function evaluateOverwatchTriggers(facts: OverwatchTriggerFacts): readonly OverwatchTriggerReason[] {
  const reasons: OverwatchTriggerReason[] = [];
  if (facts.departmentOwnershipCount > 1) reasons.push("cross_department_material");
  if (facts.openChallengeCount > 0) reasons.push("unresolved_sentinel_challenge");
  if (facts.ambiguousOrUnsupportedReviewCount > 0) reasons.push("high_uncertainty_semantic_review");
  return reasons;
}

export type OverwatchVerdict = "proceed" | "do_not_proceed" | "escalate";

export interface OverwatchJudgmentSubstance {
  readonly modelProvider: string;
  readonly modelId: string;
  readonly verdict: OverwatchVerdict;
  readonly confidence: "low" | "medium" | "high";
  readonly reasoning: string;
  readonly conditions: readonly string[];
  readonly dissentNote: string | null;
  readonly citedEvidenceIds: readonly string[];
}

export class InvalidOverwatchJudgmentError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidOverwatchJudgmentError"; }
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidOverwatchJudgmentError(`${field} is required`);
}

export function assertValidOverwatchJudgmentSubstance(value: OverwatchJudgmentSubstance): void {
  text(value.modelProvider, "Overwatch judgment modelProvider");
  text(value.modelId, "Overwatch judgment modelId");
  if (!["proceed", "do_not_proceed", "escalate"].includes(value.verdict)) throw new InvalidOverwatchJudgmentError("Overwatch judgment verdict is invalid");
  if (!["low", "medium", "high"].includes(value.confidence)) throw new InvalidOverwatchJudgmentError("Overwatch judgment confidence is invalid");
  text(value.reasoning, "Overwatch judgment reasoning");
}

export interface OverwatchSynthesis {
  readonly finalVerdict: OverwatchVerdict;
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
export function synthesizeOverwatchJudgments(judgments: readonly OverwatchJudgmentSubstance[]): OverwatchSynthesis {
  if (judgments.length === 0) throw new InvalidOverwatchJudgmentError("Overwatch synthesis requires at least one judgment");
  const dissentNotes = judgments.map((judgment) => judgment.dissentNote).filter((note): note is string => note !== null);
  const distinctModels = new Set(judgments.map((judgment) => `${judgment.modelProvider}/${judgment.modelId}`));
  const sameModelOnly = distinctModels.size <= 1;
  const distinctVerdicts = new Set(judgments.map((judgment) => judgment.verdict));
  const anyEscalateVote = judgments.some((judgment) => judgment.verdict === "escalate");
  const materialDisagreement = distinctVerdicts.size > 1;
  const anyLowConfidence = judgments.some((judgment) => judgment.confidence === "low");
  const escalated = anyEscalateVote || materialDisagreement || (anyLowConfidence && sameModelOnly);
  const finalVerdict: OverwatchVerdict = escalated ? "escalate" : judgments[0]!.verdict;
  return { finalVerdict, sameModelOnly, escalated, dissentNotes };
}
