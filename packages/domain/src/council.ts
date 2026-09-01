export interface IndependentBrief {
  readonly interpretation: string;
  readonly contribution: string;
  readonly nonGoals: readonly string[];
  readonly assumptions: readonly string[];
  readonly evidenceGaps: readonly string[];
  readonly risks: readonly string[];
  readonly dependencies: readonly string[];
  readonly proposedValidation: readonly string[];
  readonly expectedWorkers: readonly string[];
  readonly expectedCost: string;
  readonly expectedTime: string;
  readonly objectionsToLikelyAlternatives: readonly string[];
}

export interface CouncilRoundContribution {
  readonly summary: string;
  /** Tags, not free-form evidence. Persistence constrains them to known references. */
  readonly newEvidence: readonly string[];
  readonly distinctArguments: readonly string[];
}

export interface CouncilRoundNovelty {
  readonly newEvidence: readonly string[];
  readonly distinctArguments: readonly string[];
}

export interface RejectedAlternative { readonly alternative: string; readonly reason: string; }
export interface DepartmentOwnership { readonly departmentId: string; readonly responsibility: string; }
export interface WorkerPlanItem { readonly departmentId: string; readonly plan: string; }

/** A decision packet is an auditable protocol result, not a personality or vote result. */
export interface DecisionPacket {
  readonly outcome: "decided" | "escalated";
  /** Explicit execution boundary. Escalations are never executable. */
  readonly executionDisposition: "executable" | "non_executable";
  readonly selectedDirection: string;
  readonly rejectedAlternatives: readonly RejectedAlternative[];
  readonly departmentOwnership: readonly DepartmentOwnership[];
  readonly workerPlan: readonly WorkerPlanItem[];
  readonly completionCriteria: readonly string[];
  readonly failureCriteria: readonly string[];
  readonly dissent: readonly string[];
  readonly uncertainty: readonly string[];
  readonly criticalActions: readonly string[];
  /** Non-empty conflicts force outcome=escalated; they are never voted away. */
  readonly unresolvedConflicts: readonly string[];
  readonly evidenceReferences: readonly string[];
}

export class InvalidCouncilPayloadError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidCouncilPayloadError"; }
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidCouncilPayloadError(`${field} is required`);
}
function texts(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidCouncilPayloadError(`${field} must be a string list`);
}
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidCouncilPayloadError(`${name} must be an object`);
}
function objectList(value: unknown, field: string, required: readonly string[]): void {
  if (!Array.isArray(value)) throw new InvalidCouncilPayloadError(`${field} must be a list`);
  for (const item of value) { object(item, field); for (const key of required) text(item[key], `${field} ${key}`); }
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new InvalidCouncilPayloadError(`${name} has unknown field ${key}`);
}

export function assertValidIndependentBrief(value: unknown): asserts value is IndependentBrief {
  object(value, "Independent brief");
  const fields = ["interpretation", "contribution", "nonGoals", "assumptions", "evidenceGaps", "risks", "dependencies", "proposedValidation", "expectedWorkers", "expectedCost", "expectedTime", "objectionsToLikelyAlternatives"] as const;
  onlyKeys(value, fields, "Independent brief");
  for (const field of ["interpretation", "contribution", "expectedCost", "expectedTime"]) text(value[field], `Independent brief ${field}`);
  for (const field of ["nonGoals", "assumptions", "evidenceGaps", "risks", "dependencies", "proposedValidation", "expectedWorkers", "objectionsToLikelyAlternatives"]) texts(value[field], `Independent brief ${field}`);
}

export function assertValidCouncilRoundContribution(value: unknown): asserts value is CouncilRoundContribution {
  object(value, "Council round contribution");
  const fields = ["summary", "newEvidence", "distinctArguments"] as const;
  onlyKeys(value, fields, "Council round contribution");
  text(value.summary, "Council round contribution summary");
  texts(value.newEvidence, "Council round contribution newEvidence");
  texts(value.distinctArguments, "Council round contribution distinctArguments");
}

function priorValues(prior: readonly CouncilRoundNovelty[] | CouncilRoundNovelty | undefined, field: keyof CouncilRoundNovelty): Set<string> {
  const values = new Set<string>();
  if (prior === undefined) return values;
  const rounds = Array.isArray(prior) ? prior : [prior];
  for (const round of rounds) for (const value of round[field]) values.add(value.trim());
  return values;
}

/** The protocol, not a caller-supplied flag, determines whether a round advanced. */
export function isMaterialCouncilRound(contribution: CouncilRoundContribution, prior?: readonly CouncilRoundNovelty[] | CouncilRoundNovelty): boolean {
  assertValidCouncilRoundContribution(contribution);
  const priorEvidence = priorValues(prior, "newEvidence");
  const priorArguments = priorValues(prior, "distinctArguments");
  return contribution.newEvidence.some((value) => !priorEvidence.has(value.trim())) || contribution.distinctArguments.some((value) => !priorArguments.has(value.trim()));
}

export function assertValidDecisionPacket(value: unknown): asserts value is DecisionPacket {
  object(value, "Decision packet");
  const fields = ["outcome", "executionDisposition", "selectedDirection", "rejectedAlternatives", "departmentOwnership", "workerPlan", "completionCriteria", "failureCriteria", "dissent", "uncertainty", "criticalActions", "unresolvedConflicts", "evidenceReferences"] as const;
  onlyKeys(value, fields, "Decision packet");
  if (value.outcome !== "decided" && value.outcome !== "escalated") throw new InvalidCouncilPayloadError("Decision packet outcome is invalid");
  if (value.executionDisposition !== "executable" && value.executionDisposition !== "non_executable") throw new InvalidCouncilPayloadError("Decision packet execution disposition is invalid");
  text(value.selectedDirection, "Decision packet selectedDirection");
  objectList(value.rejectedAlternatives, "Decision packet rejectedAlternatives", ["alternative", "reason"]);
  objectList(value.departmentOwnership, "Decision packet departmentOwnership", ["departmentId", "responsibility"]);
  objectList(value.workerPlan, "Decision packet workerPlan", ["departmentId", "plan"]);
  for (const field of ["completionCriteria", "failureCriteria", "dissent", "uncertainty", "criticalActions", "unresolvedConflicts", "evidenceReferences"]) texts(value[field], `Decision packet ${field}`);
  const conflicts = value.unresolvedConflicts as readonly string[];
  if (value.outcome === "decided" && conflicts.length > 0) throw new InvalidCouncilPayloadError("Unresolved qualifying conflict requires escalation");
  if (value.outcome === "escalated") {
    if (conflicts.length === 0) throw new InvalidCouncilPayloadError("Escalation requires an unresolved conflict");
    if (value.executionDisposition !== "non_executable") throw new InvalidCouncilPayloadError("Escalated decision must be explicitly non-executable");
    if ((value.workerPlan as readonly unknown[]).length > 0) throw new InvalidCouncilPayloadError("Escalated decision cannot contain a worker plan");
    if ((value.criticalActions as readonly unknown[]).length > 0) throw new InvalidCouncilPayloadError("Escalated decision cannot contain critical actions");
  } else if (value.executionDisposition !== "executable") {
    throw new InvalidCouncilPayloadError("Resolved decision must be executable");
  }
}

/** Only a resolved packet can be consumed by the later Department Plan phase. */
export function isExecutableDecisionPacket(packet: DecisionPacket): boolean {
  return packet.outcome === "decided" && packet.executionDisposition === "executable";
}
