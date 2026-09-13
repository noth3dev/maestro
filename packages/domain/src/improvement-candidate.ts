import { createHash } from "node:crypto";
import {
  MODEL_CAPABILITY_AXES,
  MODEL_CAPABILITY_SCORE_MAX,
  MODEL_CAPABILITY_SCORE_MIN,
  type ModelCapabilityAxis,
} from "./model-profile.js";
import { PERSONA_AXES, type PersonaAxis } from "./persona.js";
import { assertSafeImprovementDigestText } from "./improvement-digest.js";
import { canonicalJson } from "./task-contract.js";

export const IMPROVEMENT_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const IMPROVEMENT_CANDIDATE_MAX_AXES = 2 as const;

export type ImprovementCandidateKind = "persona_axis" | "routing_capability_axis";
export type ImprovementCandidateState =
  | "candidate"
  | "evaluated"
  | "judged"
  | "applied"
  | "rejected"
  | "retained"
  | "rolled_back";

export interface ImprovementCandidateTarget {
  readonly roleId?: string;
  readonly taskClass?: string;
  readonly routingTarget?: string;
}

export interface ImprovementCandidateChange {
  readonly axis: PersonaAxis | ModelCapabilityAxis;
  readonly currentValue: number;
  readonly proposedValue: number;
}

export interface ImprovementCandidateMetricGuard {
  readonly name: string;
  readonly unit: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ImprovementCandidateMetricGoal {
  readonly name: string;
  readonly unit: string;
  readonly direction: "increase" | "decrease" | "maintain";
  readonly target?: number;
}

export interface ImprovementCandidateDataSufficiency {
  readonly episodeCount: number;
  readonly comparableGoalCount: number;
}

export interface ImprovementCandidateRollbackTarget {
  readonly candidateId: string;
  readonly version: number;
  readonly contentHash: string;
}

/** The one shared input shape used by persona and routing candidates. */
export interface ImprovementCandidateInput {
  readonly schemaVersion: typeof IMPROVEMENT_CANDIDATE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly goalId: string;
  readonly kind: ImprovementCandidateKind;
  readonly target: ImprovementCandidateTarget;
  readonly changes: readonly ImprovementCandidateChange[];
  /** UUIDs of durable Improvement Digest records. */
  readonly sourceEvidenceIds: readonly string[];
  readonly evidencePattern: string;
  readonly predictedEffect: string;
  readonly expectedMetrics: readonly ImprovementCandidateMetricGoal[];
  readonly protectedMetrics: readonly ImprovementCandidateMetricGuard[];
  readonly scenarioSuite: readonly string[];
  /** Hash of the exact ordered scenario identity list used by evaluators. */
  readonly scenarioSuiteHash: string;
  readonly confidence: number;
  readonly dataSufficiency: ImprovementCandidateDataSufficiency;
  readonly rollbackTarget: ImprovementCandidateRollbackTarget;
}

export interface ImprovementCandidate extends ImprovementCandidateInput {
  readonly candidateId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly parentCandidateId: string | null;
  readonly state: ImprovementCandidateState;
  readonly authorId: string;
  readonly sessionRef: string;
  readonly createdAt: string;
}

export interface ImprovementCandidateIdentity {
  readonly candidateId: string;
  readonly version: number;
  readonly parentCandidateId: string | null;
  readonly authorId: string;
  readonly sessionRef: string;
  readonly createdAt: string;
  readonly state?: ImprovementCandidateState;
}

export class InvalidImprovementCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImprovementCandidateError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT = 4096;
const MAX_LINE = 256;
const MAX_LIST = 32;
const MAX_METRICS = 16;
const SHA256 = /^[0-9a-f]{64}$/;
const STATES: readonly ImprovementCandidateState[] = ["candidate", "evaluated", "judged", "applied", "rejected", "retained", "rolled_back"];
const NEXT_STATES: Readonly<Record<ImprovementCandidateState, readonly ImprovementCandidateState[]>> = {
  candidate: ["evaluated", "rejected"],
  evaluated: ["judged", "rejected"],
  judged: ["applied", "rejected", "retained"],
  applied: ["retained", "rolled_back"],
  rejected: ["retained"],
  retained: ["rolled_back"],
  rolled_back: [],
};

type DataObject = Record<string, unknown>;

function object(value: unknown, name: string): asserts value is DataObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidImprovementCandidateError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidImprovementCandidateError(`${name} must be a plain object`);
}

function ownDataProperties(value: unknown, allowed: readonly string[], name: string): DataObject {
  object(value, name);
  const result: DataObject = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw new InvalidImprovementCandidateError(`${name} has unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new InvalidImprovementCandidateError(`${name} field ${key} must be an enumerable data property`);
    result[key] = descriptor.value;
  }
  return result;
}

function required(value: DataObject, fields: readonly string[], name: string): void {
  for (const field of fields) if (!Object.hasOwn(value, field)) throw new InvalidImprovementCandidateError(`${name} field ${field} is required`);
}

function line(value: unknown, field: string, max = MAX_LINE): asserts value is string {
  try {
    assertSafeImprovementDigestText(value, field, max);
  } catch (error) {
    throw new InvalidImprovementCandidateError(error instanceof Error ? error.message : `${field} is invalid`);
  }
  if (/\r|\n/.test(value)) throw new InvalidImprovementCandidateError(`${field} must be a single line`);
}

function id(value: unknown, field: string): asserts value is string {
  line(value, field);
  if (!UUID.test(value)) throw new InvalidImprovementCandidateError(`${field} must be a durable UUID`);
}

function positiveVersion(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidImprovementCandidateError(`${field} must be a positive safe integer`);
}

function finiteNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidImprovementCandidateError(`${field} must be finite`);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e21)) throw new InvalidImprovementCandidateError(`${field} must use a stable JSON number range`);
}

function boundedList(value: unknown, field: string, max = MAX_LIST): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0 || value.length > max) throw new InvalidImprovementCandidateError(`${field} must be a bounded non-empty array`);
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new InvalidImprovementCandidateError(`${field} must not be sparse`);
}

function validateTarget(value: unknown, kind: ImprovementCandidateKind): ImprovementCandidateTarget {
  const target = ownDataProperties(value, ["roleId", "taskClass", "routingTarget"], "Improvement Candidate target");
  const hasRole = Object.hasOwn(target, "roleId");
  const hasTaskClass = Object.hasOwn(target, "taskClass");
  const hasRouting = Object.hasOwn(target, "routingTarget");
  if (hasRole) line(target.roleId, "Improvement Candidate target roleId");
  if (hasTaskClass) line(target.taskClass, "Improvement Candidate target taskClass");
  if (hasRouting) line(target.routingTarget, "Improvement Candidate target routingTarget");
  if (kind === "persona_axis") {
    if (!hasRole && !hasTaskClass) throw new InvalidImprovementCandidateError("persona candidate requires a roleId or taskClass target");
    if (hasRouting) throw new InvalidImprovementCandidateError("persona candidate cannot contain a routing target");
  } else {
    if (!hasRouting) throw new InvalidImprovementCandidateError("routing candidate requires a routingTarget");
    if (hasRole || hasTaskClass) throw new InvalidImprovementCandidateError("routing candidate cannot contain a persona target");
  }
  return target as ImprovementCandidateTarget;
}

function validateChanges(value: unknown, kind: ImprovementCandidateKind): readonly ImprovementCandidateChange[] {
  boundedList(value, "Improvement Candidate changes");
  if (value.length > IMPROVEMENT_CANDIDATE_MAX_AXES) throw new InvalidImprovementCandidateError("Improvement Candidate cannot change more than two axes");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const change = ownDataProperties(raw, ["axis", "currentValue", "proposedValue"], `Improvement Candidate change ${index}`);
    required(change, ["axis", "currentValue", "proposedValue"], `Improvement Candidate change ${index}`);
    line(change.axis, `Improvement Candidate change ${index} axis`, MAX_LINE);
    const axis = change.axis as string;
    const validAxis = kind === "persona_axis" ? PERSONA_AXES.includes(axis as PersonaAxis) : MODEL_CAPABILITY_AXES.includes(axis as ModelCapabilityAxis);
    if (!validAxis) throw new InvalidImprovementCandidateError(`Improvement Candidate axis is not allowed: ${axis}`);
    if (seen.has(axis)) throw new InvalidImprovementCandidateError("Improvement Candidate changes must use unique axes");
    seen.add(axis);
    finiteNumber(change.currentValue, `Improvement Candidate change ${index} currentValue`);
    finiteNumber(change.proposedValue, `Improvement Candidate change ${index} proposedValue`);
    const minimum = kind === "persona_axis" ? 0 : MODEL_CAPABILITY_SCORE_MIN;
    const maximum = kind === "persona_axis" ? 1 : MODEL_CAPABILITY_SCORE_MAX;
    for (const [field, number] of [["currentValue", change.currentValue], ["proposedValue", change.proposedValue]] as const) {
      if (number < minimum || number > maximum) throw new InvalidImprovementCandidateError(`${field} must be in [${minimum},${maximum}]`);
      if (kind === "routing_capability_axis" && !Number.isSafeInteger(number)) throw new InvalidImprovementCandidateError(`${field} must be an integer routing score`);
    }
    if (change.currentValue === change.proposedValue) throw new InvalidImprovementCandidateError("Improvement Candidate must change each selected axis");
    return { axis: axis as PersonaAxis | ModelCapabilityAxis, currentValue: change.currentValue as number, proposedValue: change.proposedValue as number };
  });
}

function validateSourceEvidence(value: unknown): readonly string[] {
  boundedList(value, "Improvement Candidate sourceEvidenceIds");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    id(raw, `Improvement Candidate sourceEvidenceIds[${index}]`);
    const normalized = raw.toLowerCase();
    if (seen.has(normalized)) throw new InvalidImprovementCandidateError("Improvement Candidate sourceEvidenceIds must be unique");
    seen.add(normalized);
    return normalized;
  });
}

function validateExpectedMetrics(value: unknown): readonly ImprovementCandidateMetricGoal[] {
  boundedList(value, "Improvement Candidate expectedMetrics", MAX_METRICS);
  const names = new Set<string>();
  return value.map((raw, index) => {
    const metric = ownDataProperties(raw, ["name", "unit", "direction", "target"], `Improvement Candidate expected metric ${index}`);
    required(metric, ["name", "unit", "direction"], `Improvement Candidate expected metric ${index}`);
    line(metric.name, `Improvement Candidate expected metric ${index} name`, 128);
    line(metric.unit, `Improvement Candidate expected metric ${index} unit`, 64);
    if (names.has(metric.name as string)) throw new InvalidImprovementCandidateError("Improvement Candidate expected metrics must be unique");
    names.add(metric.name as string);
    if (metric.direction !== "increase" && metric.direction !== "decrease" && metric.direction !== "maintain") throw new InvalidImprovementCandidateError("Improvement Candidate expected metric direction is invalid");
    if (Object.hasOwn(metric, "target")) finiteNumber(metric.target, `Improvement Candidate expected metric ${index} target`);
    return metric as unknown as ImprovementCandidateMetricGoal;
  });
}

function validateMetrics(value: unknown): readonly ImprovementCandidateMetricGuard[] {
  boundedList(value, "Improvement Candidate protectedMetrics", MAX_METRICS);
  const names = new Set<string>();
  return value.map((raw, index) => {
    const metric = ownDataProperties(raw, ["name", "unit", "minimum", "maximum"], `Improvement Candidate protected metric ${index}`);
    required(metric, ["name", "unit"], `Improvement Candidate protected metric ${index}`);
    line(metric.name, `Improvement Candidate protected metric ${index} name`, 128);
    line(metric.unit, `Improvement Candidate protected metric ${index} unit`, 64);
    if (names.has(metric.name)) throw new InvalidImprovementCandidateError("Improvement Candidate protected metrics must be unique");
    names.add(metric.name as string);
    const hasMinimum = Object.hasOwn(metric, "minimum");
    const hasMaximum = Object.hasOwn(metric, "maximum");
    if (!hasMinimum && !hasMaximum) throw new InvalidImprovementCandidateError("Improvement Candidate protected metric requires a minimum or maximum");
    if (hasMinimum) finiteNumber(metric.minimum, `Improvement Candidate protected metric ${index} minimum`);
    if (hasMaximum) finiteNumber(metric.maximum, `Improvement Candidate protected metric ${index} maximum`);
    if (hasMinimum && hasMaximum && (metric.minimum as number) > (metric.maximum as number)) throw new InvalidImprovementCandidateError("Improvement Candidate protected metric minimum exceeds maximum");
    return metric as unknown as ImprovementCandidateMetricGuard;
  });
}

function validateScenarioSuite(value: unknown): readonly string[] {
  boundedList(value, "Improvement Candidate scenarioSuite");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    line(raw, `Improvement Candidate scenarioSuite[${index}]`);
    if (seen.has(raw)) throw new InvalidImprovementCandidateError("Improvement Candidate scenarioSuite must be unique");
    seen.add(raw);
    return raw;
  });
}

function validateScenarioSuiteHash(value: unknown, scenarioSuite: readonly string[]): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new InvalidImprovementCandidateError("Improvement Candidate scenarioSuiteHash must be a lowercase SHA-256 hash");
  const expected = improvementCandidateScenarioSuiteHash(scenarioSuite);
  if (value !== expected) throw new InvalidImprovementCandidateError("Improvement Candidate scenarioSuiteHash does not match scenarioSuite");
  return value;
}

function validateDataSufficiency(value: unknown): ImprovementCandidateDataSufficiency {
  const data = ownDataProperties(value, ["episodeCount", "comparableGoalCount"], "Improvement Candidate dataSufficiency");
  required(data, ["episodeCount", "comparableGoalCount"], "Improvement Candidate dataSufficiency");
  positiveVersion(data.episodeCount, "Improvement Candidate dataSufficiency episodeCount");
  positiveVersion(data.comparableGoalCount, "Improvement Candidate dataSufficiency comparableGoalCount");
  if ((data.comparableGoalCount as number) > (data.episodeCount as number)) throw new InvalidImprovementCandidateError("Improvement Candidate comparable goals cannot exceed episodes");
  return data as unknown as ImprovementCandidateDataSufficiency;
}

function validateRollbackTarget(value: unknown): ImprovementCandidateRollbackTarget {
  const target = ownDataProperties(value, ["candidateId", "version", "contentHash"], "Improvement Candidate rollbackTarget");
  required(target, ["candidateId", "version", "contentHash"], "Improvement Candidate rollbackTarget");
  id(target.candidateId, "Improvement Candidate rollbackTarget candidateId");
  positiveVersion(target.version, "Improvement Candidate rollbackTarget version");
  if (typeof target.contentHash !== "string" || !SHA256.test(target.contentHash)) throw new InvalidImprovementCandidateError("Improvement Candidate rollbackTarget contentHash must be a lowercase SHA-256 hash");
  return { candidateId: (target.candidateId as string).toLowerCase(), version: target.version as number, contentHash: target.contentHash };
}

export function assertValidImprovementCandidateInput(value: unknown): asserts value is ImprovementCandidateInput {
  const input = ownDataProperties(value, [
    "schemaVersion", "projectId", "goalId", "kind", "target", "changes", "sourceEvidenceIds", "evidencePattern", "predictedEffect",
    "expectedMetrics", "protectedMetrics", "scenarioSuite", "scenarioSuiteHash", "confidence", "dataSufficiency", "rollbackTarget",
  ], "Improvement Candidate");
  required(input, [
    "schemaVersion", "projectId", "goalId", "kind", "target", "changes", "sourceEvidenceIds", "evidencePattern", "predictedEffect",
    "expectedMetrics", "protectedMetrics", "scenarioSuite", "scenarioSuiteHash", "confidence", "dataSufficiency", "rollbackTarget",
  ], "Improvement Candidate");
  if (input.schemaVersion !== IMPROVEMENT_CANDIDATE_SCHEMA_VERSION) throw new InvalidImprovementCandidateError("Improvement Candidate schema version is unsupported");
  id(input.projectId, "Improvement Candidate projectId");
  id(input.goalId, "Improvement Candidate goalId");
  if (input.kind !== "persona_axis" && input.kind !== "routing_capability_axis") throw new InvalidImprovementCandidateError("Improvement Candidate kind is invalid");
  validateTarget(input.target, input.kind);
  validateChanges(input.changes, input.kind);
  validateSourceEvidence(input.sourceEvidenceIds);
  line(input.evidencePattern, "Improvement Candidate evidencePattern", MAX_TEXT);
  line(input.predictedEffect, "Improvement Candidate predictedEffect", MAX_TEXT);
  validateExpectedMetrics(input.expectedMetrics);
  validateMetrics(input.protectedMetrics);
  const scenarioSuite = validateScenarioSuite(input.scenarioSuite);
  validateScenarioSuiteHash(input.scenarioSuiteHash, scenarioSuite);
  finiteNumber(input.confidence, "Improvement Candidate confidence");
  if (input.confidence < 0 || input.confidence > 1) throw new InvalidImprovementCandidateError("Improvement Candidate confidence must be in [0,1]");
  if (input.confidence !== 0 && input.confidence < 1e-6) throw new InvalidImprovementCandidateError("Improvement Candidate confidence must use stable JSON encoding");
  validateDataSufficiency(input.dataSufficiency);
  validateRollbackTarget(input.rollbackTarget);
}

function validateIdentity(identity: ImprovementCandidateIdentity): void {
  const value = ownDataProperties(identity, ["candidateId", "version", "parentCandidateId", "authorId", "sessionRef", "createdAt", "state"], "Improvement Candidate identity");
  required(value, ["candidateId", "version", "parentCandidateId", "authorId", "sessionRef", "createdAt"], "Improvement Candidate identity");
  id(value.candidateId, "Improvement Candidate candidateId");
  positiveVersion(value.version, "Improvement Candidate version");
  if (value.parentCandidateId !== null) id(value.parentCandidateId, "Improvement Candidate parentCandidateId");
  line(value.authorId, "Improvement Candidate authorId");
  line(value.sessionRef, "Improvement Candidate sessionRef");
  line(value.createdAt, "Improvement Candidate createdAt", 128);
  if (!Number.isFinite(Date.parse(value.createdAt))) throw new InvalidImprovementCandidateError("Improvement Candidate createdAt must be a valid timestamp");
  if (value.state !== undefined && !STATES.includes(value.state as ImprovementCandidateState)) throw new InvalidImprovementCandidateError("Improvement Candidate state is invalid");
}

export function improvementCandidateScenarioSuiteHash(scenarioSuite: readonly string[]): string {
  return createHash("sha256").update(canonicalJson(scenarioSuite), "utf8").digest("hex");
}

export function improvementCandidateContentHash(input: ImprovementCandidateInput): string {
  assertValidImprovementCandidateInput(input);
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

export function materializeImprovementCandidate(input: ImprovementCandidateInput, identity: ImprovementCandidateIdentity): ImprovementCandidate {
  assertValidImprovementCandidateInput(input);
  validateIdentity(identity);
  const state = identity.state ?? "candidate";
  return Object.freeze({
    ...input,
    target: Object.freeze({ ...input.target }),
    sourceEvidenceIds: Object.freeze([...input.sourceEvidenceIds.map((id) => id.toLowerCase())]),
    changes: Object.freeze(input.changes.map((change) => Object.freeze({ ...change }))),
    expectedMetrics: Object.freeze(input.expectedMetrics.map((metric) => Object.freeze({ ...metric }))),
    protectedMetrics: Object.freeze(input.protectedMetrics.map((metric) => Object.freeze({ ...metric }))),
    scenarioSuite: Object.freeze([...input.scenarioSuite]),
    dataSufficiency: Object.freeze({ ...input.dataSufficiency }),
    rollbackTarget: Object.freeze({ ...input.rollbackTarget }),
    candidateId: identity.candidateId.toLowerCase(),
    version: identity.version,
    contentHash: improvementCandidateContentHash(input),
    parentCandidateId: identity.parentCandidateId?.toLowerCase() ?? null,
    state,
    authorId: identity.authorId,
    sessionRef: identity.sessionRef,
    createdAt: identity.createdAt,
  });
}

export function assertValidImprovementCandidate(value: unknown): asserts value is ImprovementCandidate {
  const full = ownDataProperties(value, [
    "schemaVersion", "projectId", "goalId", "kind", "target", "changes", "sourceEvidenceIds", "evidencePattern", "predictedEffect",
    "expectedMetrics", "protectedMetrics", "scenarioSuite", "scenarioSuiteHash", "confidence", "dataSufficiency", "rollbackTarget", "candidateId", "version", "contentHash", "parentCandidateId", "state", "authorId", "sessionRef", "createdAt",
  ], "Improvement Candidate record");
  required(full, [
    "schemaVersion", "projectId", "goalId", "kind", "target", "changes", "sourceEvidenceIds", "evidencePattern", "predictedEffect",
    "expectedMetrics", "protectedMetrics", "scenarioSuite", "scenarioSuiteHash", "confidence", "dataSufficiency", "rollbackTarget", "candidateId", "version", "contentHash", "parentCandidateId", "state", "authorId", "sessionRef", "createdAt",
  ], "Improvement Candidate record");
  assertValidImprovementCandidateInput({
    schemaVersion: full.schemaVersion,
    projectId: full.projectId,
    goalId: full.goalId,
    kind: full.kind,
    target: full.target,
    changes: full.changes,
    sourceEvidenceIds: full.sourceEvidenceIds,
    evidencePattern: full.evidencePattern,
    predictedEffect: full.predictedEffect,
    expectedMetrics: full.expectedMetrics,
    protectedMetrics: full.protectedMetrics,
    scenarioSuite: full.scenarioSuite,
    scenarioSuiteHash: full.scenarioSuiteHash,
    confidence: full.confidence,
    dataSufficiency: full.dataSufficiency,
    rollbackTarget: full.rollbackTarget,
  });
  validateIdentity({
    candidateId: full.candidateId as string,
    version: full.version as number,
    parentCandidateId: full.parentCandidateId as string | null,
    authorId: full.authorId as string,
    sessionRef: full.sessionRef as string,
    createdAt: full.createdAt as string,
    state: full.state as ImprovementCandidateState,
  });
  if (full.contentHash !== improvementCandidateContentHash({
    schemaVersion: full.schemaVersion as typeof IMPROVEMENT_CANDIDATE_SCHEMA_VERSION,
    projectId: full.projectId as string, goalId: full.goalId as string, kind: full.kind as ImprovementCandidateKind, target: full.target as ImprovementCandidateTarget,
    changes: full.changes as readonly ImprovementCandidateChange[], sourceEvidenceIds: full.sourceEvidenceIds as readonly string[], evidencePattern: full.evidencePattern as string, predictedEffect: full.predictedEffect as string,
    expectedMetrics: full.expectedMetrics as readonly ImprovementCandidateMetricGoal[], protectedMetrics: full.protectedMetrics as readonly ImprovementCandidateMetricGuard[], scenarioSuite: full.scenarioSuite as readonly string[], scenarioSuiteHash: full.scenarioSuiteHash as string,
    confidence: full.confidence as number, dataSufficiency: full.dataSufficiency as ImprovementCandidateDataSufficiency, rollbackTarget: full.rollbackTarget as ImprovementCandidateRollbackTarget,
  })) throw new InvalidImprovementCandidateError("Improvement Candidate contentHash does not match its input");
}

export function createImprovementCandidateVersion(
  previous: ImprovementCandidate,
  input: ImprovementCandidateInput,
  identity: ImprovementCandidateIdentity,
): ImprovementCandidate {
  assertValidImprovementCandidate(previous);
  if (identity.version !== previous.version + 1) throw new InvalidImprovementCandidateError("Improvement Candidate revision must increment version by one");
  if (identity.parentCandidateId?.toLowerCase() !== previous.candidateId.toLowerCase()) throw new InvalidImprovementCandidateError("Improvement Candidate revision must point to its parentCandidateId");
  if (identity.candidateId.toLowerCase() === previous.candidateId.toLowerCase()) throw new InvalidImprovementCandidateError("Improvement Candidate revision requires a new candidateId");
  return materializeImprovementCandidate(input, identity);
}

export function canTransitionImprovementCandidate(from: ImprovementCandidateState, to: ImprovementCandidateState): boolean {
  return NEXT_STATES[from]?.includes(to) ?? false;
}
