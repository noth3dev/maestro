import { classifyPressureBand } from "./pressure-band.js";
import { assertValidTaskDemand, taskDemandContentHash, TASK_KIND_RECIPES, type TaskDemand } from "./task-demand.js";
import { assertValidWorkCharacter, calculatePressure, type PressureCalculation, type WorkCharacter } from "./work-character.js";
import { assertValidModelMap, type ModelMapEntry } from "./model-map.js";
import { assertValidOperationalOverlaySnapshot, type OperationalOverlaySnapshot } from "./operational-overlay.js";

export const ROUTING_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const ROUTING_MODES = Object.freeze(["ensemble", "pin"] as const);
export type RoutingMode = (typeof ROUTING_MODES)[number];
export const ROUTING_EVIDENCE_BANDS = Object.freeze(["low", "medium", "high", "critical"] as const);
export type RoutingEvidenceBand = (typeof ROUTING_EVIDENCE_BANDS)[number];

export interface RoutingEvidenceRejection {
  readonly candidateRef: string;
  readonly reason: string;
}

export interface RoutingApprovalIdentity {
  readonly capabilityKind: string;
  readonly commandId: string;
  readonly action: string;
  readonly target: string;
}

export interface RoutingEvidence {
  readonly schemaVersion: typeof ROUTING_EVIDENCE_SCHEMA_VERSION;
  readonly evidenceId: string;
  readonly goalRef: string;
  readonly projectRef: string;
  readonly routeRef: string;
  readonly mode: RoutingMode;
  readonly selectedModelRef: string;
  readonly accountBinding: string;
  readonly candidateRefs: readonly string[];
  readonly selectedCandidateRef: string;
  readonly rejections: readonly RoutingEvidenceRejection[];
  readonly taskDemandHash: string;
  readonly pressure: number;
  readonly pressureBand: RoutingEvidenceBand;
  readonly decisionLayer: "automatic progress" | "Department Head" | "Encore Council" | "user";
  readonly overlayVersion: number;
  readonly admissionBindingRef: string;
  readonly rationale: string;
  readonly createdAt: string;
  readonly pressureCalculation: PressureCalculation;
  readonly taskKindRecipeVersions: Readonly<Record<string, number>>;
  readonly taskDemand: TaskDemand;
  readonly workCharacter: WorkCharacter;
  readonly modelProfile: ModelMapEntry;
  readonly operationalOverlaySnapshot: OperationalOverlaySnapshot;
  readonly approvalRef: string | null;
  readonly approvalIdentity: RoutingApprovalIdentity | null;
}

export class RoutingEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingEvidenceValidationError";
  }
}

type DataObject = Record<string, unknown>;
function object(value: unknown, name: string): asserts value is DataObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoutingEvidenceValidationError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new RoutingEvidenceValidationError(`${name} must be a plain object`);
}
function own(value: unknown, allowed: readonly string[], name: string): DataObject {
  object(value, name);
  const result: DataObject = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key))
      throw new RoutingEvidenceValidationError(`${name} has unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new RoutingEvidenceValidationError(`${name} field ${key} must be an enumerable data property`);
    result[key] = descriptor.value;
  }
  return result;
}
function required(value: DataObject, fields: readonly string[], name: string): void {
  for (const field of fields)
    if (!Object.hasOwn(value, field)) throw new RoutingEvidenceValidationError(`${name} field ${field} is required`);
}
function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value))
    throw new RoutingEvidenceValidationError(`${field} must be a non-empty single line`);
}
function ref(value: unknown, field: string): asserts value is string {
  line(value, field);
  if (/\s/.test(value)) throw new RoutingEvidenceValidationError(`${field} must not contain whitespace`);
}
function sha(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new RoutingEvidenceValidationError(`${field} must be a lowercase SHA-256 hash`);
}
function opaqueCandidateRef(value: unknown, field: string): asserts value is string {
  ref(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new RoutingEvidenceValidationError(`${field} must be an opaque candidate reference`);
}

function strictArray(value: unknown, field: string, allowEmpty: boolean): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RoutingEvidenceValidationError(`${field} must be a ${allowEmpty ? "standard" : "non-empty"} Array`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (key === "length") {
      if (!descriptor || descriptor.enumerable || !("value" in descriptor) || descriptor.value !== value.length)
        throw new RoutingEvidenceValidationError(`${field} length must be an ordinary array length`);
      continue;
    }
    if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !descriptor?.enumerable || !("value" in descriptor))
      throw new RoutingEvidenceValidationError(`${field} contains an extra or accessor property`);
  }
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, index)) throw new RoutingEvidenceValidationError(`${field} must not be sparse`);
}
function list(value: unknown, field: string): asserts value is readonly string[] {
  strictArray(value, field, false);
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string" || item.trim() === "" || /[\r\n]/.test(item))
      throw new RoutingEvidenceValidationError(`${field} contains an invalid value`);
    if (seen.has(item)) throw new RoutingEvidenceValidationError(`${field} must not contain duplicates`);
    seen.add(item);
  }
}
function rejectionList(value: unknown, field: string): asserts value is readonly RoutingEvidenceRejection[] {
  strictArray(value, field, true);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new RoutingEvidenceValidationError(`${field} must not be sparse`);
    const item = value[index];
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
    )
      throw new RoutingEvidenceValidationError(`${field}[${index}] must be a plain object`);
    const allowed = ["candidateRef", "reason"] as const;
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== "string" || !allowed.includes(key as (typeof allowed)[number]))
        throw new RoutingEvidenceValidationError(`${field}[${index}] has an unknown field`);
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new RoutingEvidenceValidationError(`${field}[${index}] contains an accessor or hidden field`);
    }
    const record = item as Record<string, unknown>;
    if (!Object.hasOwn(record, "candidateRef") || !Object.hasOwn(record, "reason"))
      throw new RoutingEvidenceValidationError(`${field}[${index}] is incomplete`);
    line(record.candidateRef, `${field}[${index}].candidateRef`);
    line(record.reason, `${field}[${index}].reason`);
  }
}

function timestamp(value: unknown, field: string): asserts value is string {
  line(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new RoutingEvidenceValidationError(`${field} must be a valid UTC datetime`);
}
function modelRef(value: unknown): asserts value is string {
  ref(value, "selectedModelRef");
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || value.indexOf("/", slash + 1) !== -1)
    throw new RoutingEvidenceValidationError("selectedModelRef must be provider-qualified");
}

function recipeVersions(value: unknown, taskKinds: readonly string[]): asserts value is Readonly<Record<string, number>> {
  object(value, "taskKindRecipeVersions");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== taskKinds.length || taskKinds.some((kind) => !Object.hasOwn(value, kind)))
    throw new RoutingEvidenceValidationError("taskKindRecipeVersions must cover exactly the declared task kinds");
  for (const key of keys) {
    if (typeof key !== "string" || !taskKinds.includes(key)) throw new RoutingEvidenceValidationError("taskKindRecipeVersions contains an undeclared task kind");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const recipe = TASK_KIND_RECIPES.find((candidate) => candidate.kind === key);
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "number" || !Number.isSafeInteger(descriptor.value) || descriptor.value < 1 || recipe === undefined || descriptor.value !== recipe.schemaVersion)
      throw new RoutingEvidenceValidationError(`taskKindRecipeVersions.${key} must match the known recipe version`);
  }
}
function modelProfile(value: unknown, selectedModelRef: string): asserts value is ModelMapEntry {
  try { assertValidModelMap({ schemaVersion: 1, entries: [value] }); } catch { throw new RoutingEvidenceValidationError("modelProfile is invalid"); }
  if ((value as ModelMapEntry).modelRef !== selectedModelRef) throw new RoutingEvidenceValidationError("modelProfile.modelRef must match selectedModelRef");
}

function pressureCalculation(value: unknown, character: WorkCharacter, pressure: number): asserts value is PressureCalculation {
  const keys = ["pressureFloor", "pressure", "explicitHeadUplift"] as const;
  const candidate = own(value, keys, "pressureCalculation");
  required(candidate, keys, "pressureCalculation");
  if (typeof candidate.pressureFloor !== "number" || !Number.isFinite(candidate.pressureFloor) || candidate.pressureFloor < 0 || candidate.pressureFloor > 200) throw new RoutingEvidenceValidationError("pressureCalculation.pressureFloor is invalid");
  if (typeof candidate.pressure !== "number" || !Number.isFinite(candidate.pressure) || candidate.pressure !== pressure) throw new RoutingEvidenceValidationError("pressureCalculation.pressure does not match routing pressure");
  if (typeof candidate.explicitHeadUplift !== "number" || !Number.isSafeInteger(candidate.explicitHeadUplift) || candidate.explicitHeadUplift < 0 || candidate.explicitHeadUplift > 200) throw new RoutingEvidenceValidationError("pressureCalculation.explicitHeadUplift is invalid");
  const expected = calculatePressure(character, candidate.explicitHeadUplift);
  if (expected.pressureFloor !== candidate.pressureFloor || expected.pressure !== candidate.pressure) throw new RoutingEvidenceValidationError("pressureCalculation cannot be replayed from WorkCharacter");
}

function approvalIdentity(value: unknown): asserts value is RoutingApprovalIdentity | null {
  if (value === null) return;
  const keys = ["capabilityKind", "commandId", "action", "target"] as const;
  const candidate = own(value, keys, "approvalIdentity");
  required(candidate, keys, "approvalIdentity");
  for (const key of keys) ref(candidate[key], `approvalIdentity.${key}`);
}

export function assertValidRoutingEvidence(value: unknown): asserts value is RoutingEvidence {
  const record = own(
    value,
    [
      "schemaVersion",
      "evidenceId",
      "goalRef",
      "projectRef",
      "routeRef",
      "mode",
      "selectedModelRef",
      "accountBinding",
      "candidateRefs",
      "selectedCandidateRef",
      "rejections",
      "taskDemandHash",
      "pressure",
      "pressureBand",
      "decisionLayer",
      "overlayVersion",
      "admissionBindingRef",
      "rationale",
      "createdAt",
      "pressureCalculation",
      "taskKindRecipeVersions",
      "taskDemand",
      "workCharacter",
      "modelProfile",
      "operationalOverlaySnapshot",
      "approvalRef",
      "approvalIdentity",
    ],
    "Routing evidence",
  );
  required(
    record,
    [
      "schemaVersion",
      "evidenceId",
      "goalRef",
      "projectRef",
      "routeRef",
      "mode",
      "selectedModelRef",
      "accountBinding",
      "candidateRefs",
      "selectedCandidateRef",
      "rejections",
      "taskDemandHash",
      "pressure",
      "pressureBand",
      "decisionLayer",
      "overlayVersion",
      "admissionBindingRef",
      "rationale",
      "createdAt",
      "taskKindRecipeVersions",
      "taskDemand",
      "workCharacter",
      "modelProfile",
      "operationalOverlaySnapshot",
      "approvalRef",
      "approvalIdentity",
    ],
    "Routing evidence",
  );
  if (record.schemaVersion !== ROUTING_EVIDENCE_SCHEMA_VERSION)
    throw new RoutingEvidenceValidationError("Routing evidence schemaVersion is invalid");
  for (const [key, valueName] of [
    ["evidenceId", "evidenceId"],
    ["goalRef", "goalRef"],
    ["projectRef", "projectRef"],
    ["routeRef", "routeRef"],
    ["accountBinding", "accountBinding"],
    ["admissionBindingRef", "admissionBindingRef"],
  ] as const)
    ref(record[key], valueName);
  line(record.rationale, "rationale");
  if (record.mode !== "ensemble" && record.mode !== "pin") throw new RoutingEvidenceValidationError("Routing evidence mode is invalid");
  modelRef(record.selectedModelRef);
  list(record.candidateRefs, "candidateRefs");
  for (const candidateRef of record.candidateRefs) opaqueCandidateRef(candidateRef, "candidateRefs entry");
  opaqueCandidateRef(record.selectedCandidateRef, "selectedCandidateRef");
  if (!record.candidateRefs.includes(record.selectedCandidateRef)) throw new RoutingEvidenceValidationError("selectedCandidateRef must be in candidateRefs");
  rejectionList(record.rejections, "rejections");
  sha(record.taskDemandHash, "taskDemandHash");
  if (typeof record.pressure !== "number" || !Number.isFinite(record.pressure) || record.pressure < 0 || record.pressure > 200)
    throw new RoutingEvidenceValidationError("Routing evidence pressure is invalid");
  if (!ROUTING_EVIDENCE_BANDS.includes(record.pressureBand as RoutingEvidenceBand))
    throw new RoutingEvidenceValidationError("Routing evidence pressureBand is invalid");
  if (!["automatic progress", "Department Head", "Encore Council", "user"].includes(String(record.decisionLayer)))
    throw new RoutingEvidenceValidationError("Routing evidence decisionLayer is invalid");
  const projection = classifyPressureBand(record.pressure);
  if (projection.band !== record.pressureBand || projection.decisionLayer !== record.decisionLayer)
    throw new RoutingEvidenceValidationError("Routing evidence pressure projection does not match band or decision layer");
  if (typeof record.overlayVersion !== "number" || !Number.isSafeInteger(record.overlayVersion) || record.overlayVersion < 1)
    throw new RoutingEvidenceValidationError("Routing evidence overlayVersion is invalid");
  timestamp(record.createdAt, "Routing evidence createdAt");
  if (record.approvalRef !== null && record.approvalIdentity === null) throw new RoutingEvidenceValidationError("approvalIdentity is required when approvalRef is present");
  if (record.approvalRef === null && record.approvalIdentity !== null) throw new RoutingEvidenceValidationError("approvalIdentity requires approvalRef");
  approvalIdentity(record.approvalIdentity);
  try { assertValidTaskDemand(record.taskDemand); } catch { throw new RoutingEvidenceValidationError("Routing evidence taskDemand is invalid"); }
  const taskDemand = record.taskDemand as TaskDemand;
  recipeVersions(record.taskKindRecipeVersions, taskDemand.taskKinds);
  try { assertValidWorkCharacter(record.workCharacter); } catch { throw new RoutingEvidenceValidationError("Routing evidence workCharacter is invalid"); }
  const workCharacter = record.workCharacter as WorkCharacter;
  if (workCharacter.provenance.taskContractRef !== taskDemand.provenance.taskContractRef || workCharacter.provenance.headDecisionRef !== taskDemand.provenance.headDecisionRef)
    throw new RoutingEvidenceValidationError("TaskDemand and WorkCharacter provenance must agree");
  pressureCalculation(record.pressureCalculation, workCharacter, record.pressure);
  const expectedTaskDemandHash = taskDemandContentHash(taskDemand);
  if (record.taskDemandHash !== expectedTaskDemandHash) throw new RoutingEvidenceValidationError("taskDemandHash does not match the sealed TaskDemand");
  modelProfile(record.modelProfile, record.selectedModelRef);
  try { assertValidOperationalOverlaySnapshot(record.operationalOverlaySnapshot); } catch { throw new RoutingEvidenceValidationError("Routing evidence operationalOverlaySnapshot is invalid"); }
  const overlay = record.operationalOverlaySnapshot as OperationalOverlaySnapshot;
  if (overlay.goalRef !== record.goalRef || overlay.projectRef !== record.projectRef || overlay.overlayVersion !== record.overlayVersion)
    throw new RoutingEvidenceValidationError("Routing evidence operational overlay identity does not match route");
  const selectedObservation = overlay.observations.find((observation) => observation.candidateRef === record.selectedCandidateRef);
  if (selectedObservation === undefined || !selectedObservation.currentAvailability || selectedObservation.accountBinding !== record.accountBinding)
    throw new RoutingEvidenceValidationError("Selected candidate is not available under the recorded account binding");
  for (const candidateRef of record.candidateRefs) if (!overlay.observations.some((observation) => observation.candidateRef === candidateRef)) throw new RoutingEvidenceValidationError("Every candidate must have an operational observation");
  if (record.approvalRef !== null) ref(record.approvalRef, "approvalRef");
}
