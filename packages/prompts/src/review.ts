/** Independent reviewer prompts. */

export interface ReviewCriterion {
  readonly criterionId: string;
  readonly description: string;
}

export function encoreReviewerPrompt(input: { readonly question: string; readonly criteria: readonly ReviewCriterion[]; readonly evidenceIds: readonly string[] }): string {
  return [
    "You are one of several fully independent Encore Council reviewers. You cannot see any other reviewer's answer.",
    `Question: ${input.question}`,
    `Criteria: ${input.criteria.map((criterion) => `[${criterion.criterionId}] ${criterion.description}`).join("; ")}`,
    `Evidence ids you may cite: ${input.evidenceIds.join(", ") || "(none)"}`,
    'Reply with exactly one JSON object: {"verdict":"proceed"|"do_not_proceed"|"escalate","confidence":"low"|"medium"|"high","reasoning":string,"conditions":string[],"dissentNote":string|null,"citedEvidenceIds":string[]}',
  ].join("\n");
}

export function semanticReviewerPrompt(input: { readonly claimText: string; readonly criteria: readonly ReviewCriterion[]; readonly evidenceIds: readonly string[] }): string {
  const criteriaText = input.criteria.map((criterion) => `- [${criterion.criterionId}] ${criterion.description}`).join("\n");
  const evidenceText = input.evidenceIds.length > 0 ? input.evidenceIds.join(", ") : "(none)";
  return [
    "You are an isolated semantic reviewer. You have no access to any other reviewer's answer.",
    "Judge the following claim strictly against the fixed criteria below. Do not invent evidence.",
    "",
    "Claim:",
    input.claimText,
    "",
    "Fixed criteria:",
    criteriaText,
    "",
    "Evidence ids you may cite (cite only from this list; citing anything else is invalid):",
    evidenceText,
    "",
    'Reply with exactly one JSON object and nothing else: {"verdict": "supported"|"unsupported"|"ambiguous", "citedEvidenceIds": string[], "reasoning": string}',
  ].join("\n");
}
