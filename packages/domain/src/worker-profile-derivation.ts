import { assertValidImprovementCandidateInput, improvementCandidateScenarioSuiteHash, type ImprovementCandidateInput, type ImprovementCandidateMetricGoal, type ImprovementCandidateMetricGuard, type ImprovementCandidateRollbackTarget } from "./improvement-candidate.js";
import { isMissionPersonaOverlayExpired } from "./mission-bundle.js";
import { parsePersonaProfile, PERSONA_AXES, type PersonaAxis, type PersonaLayerDelta, type PersonaProfile } from "./persona.js";

export const WORKER_PROFILE_MAX_AXIS_DELTA = 0.15 as const;
export interface WorkerProfileDerivationInput {
  readonly roleId: string;
  readonly taskClass: string;
  readonly taskClassTemplate: PersonaProfile;
  readonly headProfile: PersonaProfile;
  readonly workerId?: string;
  /** Optional mission context is retained with the assignment for later learning. */
  readonly departmentBaseline?: PersonaProfile;
  readonly missionType?: string; readonly risk?: number; readonly collaborationDemand?: number; readonly taskAmbiguity?: number; readonly reversibility?: number; readonly timePressure?: number; readonly evidenceBurden?: number;
  readonly missionOverlay: PersonaLayerDelta;
  readonly missionOverlayExpiresAt: string;
  readonly assignmentRef: string;
  readonly roleFloors?: Readonly<Partial<Record<PersonaAxis, number>>>;
  readonly roleCeilings?: Readonly<Partial<Record<PersonaAxis, number>>>;
}
export interface WorkerProfileDeltaExplanation {
  readonly axis: PersonaAxis;
  readonly delta: number;
  readonly absoluteDelta: number;
  readonly assignmentRef: string;
  readonly reason: "head delegation plus mission overlay";
}
export interface WorkerProfileDerivation {
  readonly roleId: string;
  readonly taskClass: string;
  readonly workerId?: string | undefined;
  readonly profile: PersonaProfile;
  readonly taskClassTemplate: PersonaProfile;
  readonly headProfile: PersonaProfile;
  /** Optional mission context is retained with the assignment for later learning. */
  readonly departmentBaseline?: PersonaProfile | undefined;
  readonly missionType?: string | undefined; readonly risk?: number | undefined; readonly collaborationDemand?: number | undefined; readonly taskAmbiguity?: number | undefined; readonly reversibility?: number | undefined; readonly timePressure?: number | undefined; readonly evidenceBurden?: number | undefined;
  readonly missionOverlay: PersonaLayerDelta;
  readonly missionOverlayExpiresAt: string;
  readonly assignmentRef: string;
  readonly explanations: readonly WorkerProfileDeltaExplanation[];
}

export class InvalidWorkerProfileDerivationError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidWorkerProfileDerivationError"; }
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) throw new InvalidWorkerProfileDerivationError(`${field} must be a non-empty single-line string`);
}
function scalar(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new InvalidWorkerProfileDerivationError(`${field} must be normalized to [0,1]`);
}
function parseBounds(value: Readonly<Partial<Record<PersonaAxis, number>>> | undefined, name: string): Readonly<Partial<Record<PersonaAxis, number>>> {
  if (value === undefined) return Object.freeze({});
  const result: Partial<Record<PersonaAxis, number>> = {};
  for (const key of Object.keys(value)) {
    if (!PERSONA_AXES.includes(key as PersonaAxis)) throw new InvalidWorkerProfileDerivationError(`${name} contains unknown axis ${key}`);
    const bound = value[key as PersonaAxis];
    scalar(bound, `${name}.${key}`);
    result[key as PersonaAxis] = bound;
  }
  return Object.freeze(result);
}
function parseOverlay(value: PersonaLayerDelta): PersonaLayerDelta {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidWorkerProfileDerivationError("missionOverlay must be an object");
  const result: Partial<Record<PersonaAxis, number>> = {};
  for (const key of Object.keys(value)) {
    if (!PERSONA_AXES.includes(key as PersonaAxis)) throw new InvalidWorkerProfileDerivationError(`missionOverlay contains unknown axis ${key}`);
    const delta = value[key as PersonaAxis];
    if (typeof delta !== "number" || !Number.isFinite(delta) || Math.abs(delta) > WORKER_PROFILE_MAX_AXIS_DELTA + 1e-9) throw new InvalidWorkerProfileDerivationError(`missionOverlay.${key} must be within ±${WORKER_PROFILE_MAX_AXIS_DELTA}`);
    result[key as PersonaAxis] = delta;
  }
  return Object.freeze(result);
}

/** Derive a temporary worker profile from a reviewed task template, never from scratch. */
export function deriveWorkerProfile(input: WorkerProfileDerivationInput): WorkerProfileDerivation {
  text(input.roleId, "worker profile roleId"); text(input.taskClass, "worker profile taskClass"); text(input.assignmentRef, "worker profile assignmentRef"); text(input.missionOverlayExpiresAt, "worker profile missionOverlayExpiresAt");
  const expiryAt = Date.parse(input.missionOverlayExpiresAt);
  if (Number.isNaN(expiryAt)) throw new InvalidWorkerProfileDerivationError("worker profile missionOverlayExpiresAt must be a valid timestamp");
  if (expiryAt <= Date.now()) throw new InvalidWorkerProfileDerivationError("worker profile missionOverlay has already expired");
  if (input.workerId !== undefined) text(input.workerId, "worker profile workerId");
  if (input.missionType !== undefined) text(input.missionType, "worker profile missionType");
  for (const [name, value] of Object.entries({ risk: input.risk, collaborationDemand: input.collaborationDemand, taskAmbiguity: input.taskAmbiguity, reversibility: input.reversibility, timePressure: input.timePressure, evidenceBurden: input.evidenceBurden })) if (value !== undefined) scalar(value, `worker profile ${name}`);
  const departmentBaseline = input.departmentBaseline === undefined ? undefined : Object.freeze({ ...parsePersonaProfile(input.departmentBaseline) });
  const template = Object.freeze({ ...parsePersonaProfile(input.taskClassTemplate) });
  const head = Object.freeze({ ...parsePersonaProfile(input.headProfile) });
  const overlay = parseOverlay(input.missionOverlay);
  const floors = parseBounds(input.roleFloors, "roleFloors"); const ceilings = parseBounds(input.roleCeilings, "roleCeilings");
  const values = {} as Record<PersonaAxis, number>; const deltas: WorkerProfileDeltaExplanation[] = [];
  for (const axis of PERSONA_AXES) {
    const floor = floors[axis] ?? 0; const ceiling = ceilings[axis] ?? 1;
    if (floor > ceiling) throw new InvalidWorkerProfileDerivationError(`${axis} floor exceeds ceiling`);
    const delta = head[axis] - template[axis] + (overlay[axis] ?? 0);
    if (Math.abs(delta) > WORKER_PROFILE_MAX_AXIS_DELTA + 1e-9) throw new InvalidWorkerProfileDerivationError(`${axis} exceeds the ±${WORKER_PROFILE_MAX_AXIS_DELTA} worker derivation bound`);
    const value = template[axis] + delta;
    if (value < floor) throw new InvalidWorkerProfileDerivationError(`${axis} violates role floor`);
    if (value > ceiling) throw new InvalidWorkerProfileDerivationError(`${axis} violates role ceiling`);
    values[axis] = value;
    deltas.push({ axis, delta, absoluteDelta: Math.abs(delta), assignmentRef: input.assignmentRef, reason: "head delegation plus mission overlay" });
  }
  const explanations = deltas.sort((left, right) => right.absoluteDelta - left.absoluteDelta || left.axis.localeCompare(right.axis)).slice(0, 3).map((item) => Object.freeze(item));
  return Object.freeze({ roleId: input.roleId, taskClass: input.taskClass, workerId: input.workerId, profile: Object.freeze(values), taskClassTemplate: template, headProfile: head, departmentBaseline, missionType: input.missionType, risk: input.risk, collaborationDemand: input.collaborationDemand, taskAmbiguity: input.taskAmbiguity, reversibility: input.reversibility, timePressure: input.timePressure, evidenceBurden: input.evidenceBurden, missionOverlay: overlay, missionOverlayExpiresAt: input.missionOverlayExpiresAt, assignmentRef: input.assignmentRef, explanations: Object.freeze(explanations) });
}

export function isWorkerPersonaOverlayExpired(derivation: Pick<WorkerProfileDerivation, "missionOverlayExpiresAt">, now: Date): boolean {
  return isMissionPersonaOverlayExpired({ expiresAt: derivation.missionOverlayExpiresAt }, now);
}
export interface WorkerPersonaImprovementCandidateRequest {
  readonly projectId: string; readonly goalId: string; readonly roleId: string; readonly taskClass: string;
  readonly currentProfile: PersonaProfile; readonly proposedProfile: PersonaProfile;
  readonly sourceEvidenceIds: readonly string[]; readonly evidencePattern: string; readonly predictedEffect: string;
  readonly expectedMetrics: readonly ImprovementCandidateMetricGoal[]; readonly protectedMetrics: readonly ImprovementCandidateMetricGuard[];
  readonly scenarioSuite: readonly string[]; readonly confidence: number; readonly episodeCount: number; readonly comparableGoalCount: number;
  readonly rollbackTarget: ImprovementCandidateRollbackTarget;
}

/** Adapt worker outcome evidence to the shared candidate schema without creating a second candidate format. */
export function buildWorkerPersonaImprovementCandidate(request: WorkerPersonaImprovementCandidateRequest): ImprovementCandidateInput {
  const current = parsePersonaProfile(request.currentProfile); const proposed = parsePersonaProfile(request.proposedProfile);
  const changes = PERSONA_AXES.filter((axis) => current[axis] !== proposed[axis]).map((axis) => ({ axis, currentValue: current[axis], proposedValue: proposed[axis] }));
  if (changes.length === 0 || changes.length > 2) throw new InvalidWorkerProfileDerivationError("worker persona candidates must change one or two axes");
  const candidate: ImprovementCandidateInput = {
    schemaVersion: 1, projectId: request.projectId, goalId: request.goalId, kind: "persona_axis",
    target: { roleId: request.roleId, taskClass: request.taskClass }, changes, sourceEvidenceIds: request.sourceEvidenceIds,
    evidencePattern: request.evidencePattern, predictedEffect: request.predictedEffect, expectedMetrics: request.expectedMetrics,
    protectedMetrics: request.protectedMetrics, scenarioSuite: request.scenarioSuite, scenarioSuiteHash: improvementCandidateScenarioSuiteHash(request.scenarioSuite),
    confidence: request.confidence, dataSufficiency: { episodeCount: request.episodeCount, comparableGoalCount: request.comparableGoalCount }, rollbackTarget: request.rollbackTarget,
  };
  assertValidImprovementCandidateInput(candidate);
  return Object.freeze({ ...candidate, target: Object.freeze({ ...candidate.target }), changes: Object.freeze(candidate.changes.map((change) => Object.freeze({ ...change }))) });
}


export interface PersonaGoalEvidenceInput {
  readonly projectId: string; readonly goalId: string; readonly roleId: string; readonly taskClass: string;
  readonly taskContractVersion: number; readonly activeProfileVersion: number; readonly missionOverlay: PersonaLayerDelta;
  readonly modelRef: string; readonly skills: readonly string[]; readonly tools: readonly string[];
  readonly contextSizeTokens: number; readonly budgetCents: number; readonly collaboratorSet: readonly string[];
  readonly qualityFindings: readonly string[]; readonly securityFindings: readonly string[]; readonly safetyFindings: readonly string[]; readonly finalCertification: string;
  readonly reworkCount: number; readonly retryCount: number; readonly planRevisionCount: number; readonly escapedDefectCount: number;
  readonly timeToFirstUsefulOutputMs: number; readonly timeToCertifiedCompletionMs: number; readonly tokenCost: number; readonly monetaryCostCents: number;
  readonly usefulMessageCount: number; readonly unnecessaryMessageCount: number; readonly scopeViolationCount: number; readonly authorityDenialCount: number;
  readonly safePauseCount: number; readonly falsePositivePauseCount: number; readonly dissentQuality: string; readonly dissentChangedOutcome: boolean;
  readonly userCorrections: readonly string[]; readonly explicitFeedback: string; readonly comparedProfileVersions: readonly string[];
}
export interface PersonaGoalEvidence extends PersonaGoalEvidenceInput { readonly evidenceId: string; readonly createdAt: string; }
export class InvalidPersonaGoalEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidPersonaGoalEvidenceError"; }
}
function evidenceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new InvalidPersonaGoalEvidenceError("persona Goal evidence must be an object");
  return value as Record<string, unknown>;
}
function evidenceText(value: unknown, field: string): asserts value is string { if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) throw new InvalidPersonaGoalEvidenceError(`${field} must be a non-empty single-line string`); }
function evidenceCount(value: unknown, field: string): asserts value is number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidPersonaGoalEvidenceError(`${field} must be a nonnegative safe integer`); }
function evidenceMetric(value: unknown, field: string): asserts value is number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new InvalidPersonaGoalEvidenceError(`${field} must be a nonnegative finite number`); }
function evidenceList(value: unknown, field: string): asserts value is readonly string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "" || /[\r\n]/.test(item))) throw new InvalidPersonaGoalEvidenceError(`${field} must be a string list`); }

export function parsePersonaGoalEvidence(value: unknown): PersonaGoalEvidenceInput {
  const record = evidenceObject(value);
  const fields = ["projectId", "goalId", "roleId", "taskClass", "taskContractVersion", "activeProfileVersion", "missionOverlay", "modelRef", "skills", "tools", "contextSizeTokens", "budgetCents", "collaboratorSet", "qualityFindings", "securityFindings", "safetyFindings", "finalCertification", "reworkCount", "retryCount", "planRevisionCount", "escapedDefectCount", "timeToFirstUsefulOutputMs", "timeToCertifiedCompletionMs", "tokenCost", "monetaryCostCents", "usefulMessageCount", "unnecessaryMessageCount", "scopeViolationCount", "authorityDenialCount", "safePauseCount", "falsePositivePauseCount", "dissentQuality", "dissentChangedOutcome", "userCorrections", "explicitFeedback", "comparedProfileVersions"] as const;
  for (const key of Reflect.ownKeys(record)) if (typeof key !== "string" || !fields.includes(key as typeof fields[number])) throw new InvalidPersonaGoalEvidenceError(`persona Goal evidence has unknown field ${String(key)}`);
  for (const field of ["projectId", "goalId", "roleId", "taskClass", "modelRef", "finalCertification", "dissentQuality"] as const) evidenceText(record[field], field);
  for (const field of ["skills", "tools", "collaboratorSet", "qualityFindings", "securityFindings", "safetyFindings", "userCorrections", "comparedProfileVersions"] as const) evidenceList(record[field], field);
  evidenceCount(record.taskContractVersion, "taskContractVersion"); evidenceCount(record.activeProfileVersion, "activeProfileVersion");
  const overlay = parseOverlay(record.missionOverlay as PersonaLayerDelta);
  for (const field of ["contextSizeTokens", "budgetCents", "timeToFirstUsefulOutputMs", "timeToCertifiedCompletionMs", "tokenCost", "monetaryCostCents"] as const) evidenceMetric(record[field], field);
  for (const field of ["reworkCount", "retryCount", "planRevisionCount", "escapedDefectCount", "usefulMessageCount", "unnecessaryMessageCount", "scopeViolationCount", "authorityDenialCount", "safePauseCount", "falsePositivePauseCount"] as const) evidenceCount(record[field], field);
  if (typeof record.dissentChangedOutcome !== "boolean") throw new InvalidPersonaGoalEvidenceError("dissentChangedOutcome must be boolean");
  if (typeof record.explicitFeedback !== "string" || /[\r\n]/.test(record.explicitFeedback)) throw new InvalidPersonaGoalEvidenceError("explicitFeedback must be single-line text");
  return Object.freeze({ ...record, missionOverlay: overlay }) as PersonaGoalEvidenceInput;
}
