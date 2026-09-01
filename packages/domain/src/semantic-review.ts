export type SemanticReviewVerdict = "supported" | "unsupported" | "ambiguous";

export class InvalidSemanticReviewRequestError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSemanticReviewRequestError"; }
}

export interface SemanticReviewCriterion {
  readonly criterionId: string;
  readonly description: string;
}

export interface SemanticReviewRequest {
  readonly claimText: string;
  readonly criteria: readonly SemanticReviewCriterion[];
  readonly availableEvidenceIds: readonly string[];
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidSemanticReviewRequestError(`${field} is required`);
}

export function assertValidSemanticReviewRequest(request: SemanticReviewRequest): void {
  text(request.claimText, "Semantic review claimText");
  if (request.criteria.length === 0) throw new InvalidSemanticReviewRequestError("Semantic review requires at least one fixed criterion");
  for (const criterion of request.criteria) {
    text(criterion.criterionId, "Semantic review criterion id");
    text(criterion.description, "Semantic review criterion description");
  }
}

/**
 * The fixed, deterministic prompt. It contains exactly the claim, the fixed
 * criteria, and the list of evidence ids the reviewer may cite -- nothing
 * else. No peer answer, no prior reviewer's reasoning, and no free-form
 * caller instruction can be injected through this builder, which is what
 * gives the review an isolated context.
 */
export function buildSemanticReviewPrompt(request: SemanticReviewRequest): string {
  assertValidSemanticReviewRequest(request);
  const criteriaText = request.criteria.map((criterion) => `- [${criterion.criterionId}] ${criterion.description}`).join("\n");
  const evidenceText = request.availableEvidenceIds.length > 0 ? request.availableEvidenceIds.join(", ") : "(none)";
  return [
    "You are an isolated semantic reviewer. You have no access to any other reviewer's answer.",
    "Judge the following claim strictly against the fixed criteria below. Do not invent evidence.",
    "",
    "Claim:",
    request.claimText,
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

export interface RawSemanticReviewOutput {
  readonly verdict: SemanticReviewVerdict;
  readonly citedEvidenceIds: readonly string[];
  readonly reasoning: string;
}

export class InvalidSemanticReviewOutputError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSemanticReviewOutputError"; }
}

/** Strictly parses the model's structured output. Never fabricates a verdict from unparseable or malformed text -- the caller must treat a thrown error as an inability to obtain a judgment, not silently as any particular verdict. */
export function parseSemanticReviewOutput(rawText: string): RawSemanticReviewOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new InvalidSemanticReviewOutputError("Semantic review output is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InvalidSemanticReviewOutputError("Semantic review output must be a JSON object");
  const record = parsed as Record<string, unknown>;
  if (record.verdict !== "supported" && record.verdict !== "unsupported" && record.verdict !== "ambiguous") {
    throw new InvalidSemanticReviewOutputError("Semantic review output verdict is invalid");
  }
  if (!Array.isArray(record.citedEvidenceIds) || !record.citedEvidenceIds.every((item) => typeof item === "string")) {
    throw new InvalidSemanticReviewOutputError("Semantic review output citedEvidenceIds must be a string array");
  }
  if (typeof record.reasoning !== "string" || record.reasoning.trim() === "") throw new InvalidSemanticReviewOutputError("Semantic review output reasoning is required");
  return { verdict: record.verdict, citedEvidenceIds: record.citedEvidenceIds, reasoning: record.reasoning };
}

/**
 * "Model judge output lacks evidence: classify as unsupported and do not
 * escalate its confidence." This is the single authority on the verdict
 * actually recorded; the model's raw claimed verdict is never trusted
 * directly.
 */
export function resolveSemanticReviewVerdict(output: RawSemanticReviewOutput, durableEvidenceIds: ReadonlySet<string>): SemanticReviewVerdict {
  const validCitations = output.citedEvidenceIds.filter((id) => durableEvidenceIds.has(id.trim()));
  if (validCitations.length === 0) return "unsupported";
  return output.verdict;
}
