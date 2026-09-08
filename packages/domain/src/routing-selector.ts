import { assertValidModelMap, type ModelMap } from "./model-map.js";
import { MODEL_CAPABILITY_AXES, type ModelCapabilityAxis } from "./model-profile.js";
import { assertValidOperationalOverlaySnapshot, type OperationalOverlaySnapshot } from "./operational-overlay.js";
import { assertValidPressure, classifyPressureBand, type PressureBandProjection } from "./pressure-band.js";
import { assertValidTaskDemand, type TaskDemand } from "./task-demand.js";

export const ROUTING_DECISION_SCHEMA_VERSION = 1 as const;

export interface RouterCandidate {
  readonly candidateRef: string;
  readonly modelRef: string;
  readonly accountBinding: string;
}

export interface RoutingSelectionRequest {
  readonly mode: "ensemble" | "pin";
  readonly goalRef: string;
  readonly approvedModels: readonly string[];
  readonly pinModelRef?: string;
  readonly taskDemand: TaskDemand;
  readonly modelMap: ModelMap;
  readonly operationalOverlay: OperationalOverlaySnapshot;
  readonly candidates: readonly RouterCandidate[];
  readonly pressure: number;
  readonly requiredContextCapacity?: number;
  readonly requiredToolCalls?: boolean;
  readonly requiredDataClass?: string;
  readonly requiredModality?: string;
}

export interface RoutingCandidateRejection {
  readonly candidateRef: string;
  readonly reason: string;
}

export interface RoutingSelection {
  readonly schemaVersion: typeof ROUTING_DECISION_SCHEMA_VERSION;
  readonly goalRef: string;
  readonly mode: "ensemble" | "pin";
  readonly selectedCandidateRef: string;
  readonly selectedModelRef: string;
  readonly accountBinding: string;
  readonly candidateRefs: readonly string[];
  readonly rejected: readonly RoutingCandidateRejection[];
  readonly pressure: PressureBandProjection;
  readonly rationale: string;
}

export class RoutingSelectionError extends Error {
  readonly rejected: readonly RoutingCandidateRejection[];
  constructor(message: string, rejected: readonly RoutingCandidateRejection[] = []) {
    super(message);
    this.name = "RoutingSelectionError";
    this.rejected = rejected;
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value))
    throw new RoutingSelectionError(`${field} must be a non-empty single line`);
}
function modelRef(value: unknown, field: string): asserts value is string {
  line(value, field);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || value.indexOf("/", slash + 1) !== -1 || /\s/.test(value))
    throw new RoutingSelectionError(`${field} must be an exact provider/model identity`);
}
function requiredNumber(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0))
    throw new RoutingSelectionError(`${field} must be a non-negative safe integer`);
}
function uniqueStrings(value: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const item of value) {
    line(item, field);
    if (seen.has(item)) throw new RoutingSelectionError(`${field} must not contain duplicates`);
    seen.add(item);
  }
}

function standardArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RoutingSelectionError(`${field} must be a standard Array`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      throw new RoutingSelectionError(`${field} contains an unknown property`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new RoutingSelectionError(`${field} contains an accessor or hidden property`);
  }
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, index)) throw new RoutingSelectionError(`${field} must not be sparse`);
  return value;
}

function candidateRecord(value: unknown): RouterCandidate {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw new RoutingSelectionError("candidate must be a plain object");
  const allowed = ["candidateRef", "modelRef", "accountBinding"] as const;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key as (typeof allowed)[number]))
      throw new RoutingSelectionError("candidate has an unknown field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new RoutingSelectionError("candidate contains an accessor or hidden property");
  }
  if (!Object.hasOwn(value, "candidateRef") || !Object.hasOwn(value, "modelRef") || !Object.hasOwn(value, "accountBinding"))
    throw new RoutingSelectionError("candidate is incomplete");
  const record = value as Record<string, unknown>;
  line(record.candidateRef, "candidateRef");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(record.candidateRef)) throw new RoutingSelectionError("candidateRef must be opaque");
  line(record.accountBinding, "candidate accountBinding");
  modelRef(record.modelRef, "candidate modelRef");
  return { candidateRef: record.candidateRef, modelRef: record.modelRef, accountBinding: record.accountBinding };
}

function axisRequirement(taskDemand: TaskDemand, axis: ModelCapabilityAxis): number {
  return taskDemand.requirements[axis].level;
}

export function selectRoutedModel(input: RoutingSelectionRequest): RoutingSelection {
  line(input.goalRef, "goalRef");
  if (input.mode !== "ensemble" && input.mode !== "pin") throw new RoutingSelectionError("mode must be ensemble or pin");
  const approvedModelValues = standardArray(input.approvedModels, "approvedModels");
  if (approvedModelValues.length === 0) throw new RoutingSelectionError("approvedModels must be non-empty");
  const approvedModels = approvedModelValues as readonly string[];
  uniqueStrings(approvedModels, "approvedModels");
  approvedModels.forEach((value) => modelRef(value, "approvedModels entry"));
  if (input.mode === "pin") {
    modelRef(input.pinModelRef, "pinModelRef");
    if (!approvedModels.includes(input.pinModelRef)) throw new RoutingSelectionError("pinModelRef must be approved by the Mission Bundle");
  }
  if (input.mode === "ensemble" && input.pinModelRef !== undefined)
    throw new RoutingSelectionError("ensemble mode cannot carry pinModelRef");
  if (input.requiredToolCalls !== undefined && typeof input.requiredToolCalls !== "boolean")
    throw new RoutingSelectionError("requiredToolCalls must be boolean");
  requiredNumber(input.requiredContextCapacity, "requiredContextCapacity");
  if (input.requiredDataClass !== undefined) line(input.requiredDataClass, "requiredDataClass");
  if (input.requiredModality !== undefined) line(input.requiredModality, "requiredModality");
  assertValidTaskDemand(input.taskDemand);
  assertValidModelMap(input.modelMap);
  assertValidOperationalOverlaySnapshot(input.operationalOverlay);
  assertValidPressure(input.pressure);
  if (input.operationalOverlay.goalRef !== input.goalRef)
    throw new RoutingSelectionError("operational overlay snapshot is bound to a different Goal");
  const candidateValues = standardArray(input.candidates, "candidates");
  if (candidateValues.length === 0) throw new RoutingSelectionError("candidates must be non-empty");
  const map = new Map(input.modelMap.entries.map((entry) => [entry.modelRef, entry]));
  const observations = new Map(input.operationalOverlay.observations.map((observation) => [observation.candidateRef, observation]));
  const rejected: RoutingCandidateRejection[] = [];
  const passing: Array<{ candidate: RouterCandidate; capabilityScore: number; latency: number; failureRate: number }> = [];
  const refs = new Set<string>();
  for (const rawCandidate of candidateValues) {
    let candidate: RouterCandidate;
    try {
      candidate = candidateRecord(rawCandidate);
    } catch (error) {
      rejected.push({ candidateRef: "<invalid>", reason: error instanceof Error ? error.message : "invalid candidate" });
      continue;
    }
    if (refs.has(candidate.candidateRef)) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "duplicate candidateRef" });
      continue;
    }
    refs.add(candidate.candidateRef);
    if (!approvedModels.includes(candidate.modelRef)) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "model is not approved by the Mission Bundle" });
      continue;
    }
    if (input.mode === "pin" && candidate.modelRef !== input.pinModelRef) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "candidate is outside the explicit pin identity" });
      continue;
    }
    const entry = map.get(candidate.modelRef);
    if (entry === undefined) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "model has no human-owned model_map entry" });
      continue;
    }
    const observation = observations.get(candidate.candidateRef);
    if (observation === undefined) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "candidate has no Goal-scoped operational observation" });
      continue;
    }
    if (!observation.currentAvailability) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "candidate is currently unavailable" });
      continue;
    }
    if (observation.accountBinding !== candidate.accountBinding) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "candidate account binding does not match the Goal snapshot" });
      continue;
    }
    if (input.requiredContextCapacity !== undefined && entry.providerFacts.contextCapacity < input.requiredContextCapacity) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "provider context capacity is below the requirement" });
      continue;
    }
    if (input.requiredToolCalls === true && !entry.providerFacts.toolCalls.supported) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "provider does not support required tool calls" });
      continue;
    }
    if (input.requiredDataClass !== undefined && !entry.providerFacts.dataPolicy.allowedDataClasses.includes(input.requiredDataClass)) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "provider data policy does not allow the required data class" });
      continue;
    }
    if (input.requiredModality !== undefined && !entry.providerFacts.modalities.includes(input.requiredModality)) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "provider does not support the required modality" });
      continue;
    }
    let capabilityScore = 0;
    let invalidCapability = false;
    for (const axis of MODEL_CAPABILITY_AXES) {
      const requirement = axisRequirement(input.taskDemand, axis);
      const score = entry.capability.axes[axis];
      if (requirement > 0 && (score.status !== "scored" || score.score === null || score.score < requirement)) {
        invalidCapability = true;
        break;
      }
      capabilityScore += score.score ?? 0;
    }
    if (invalidCapability) {
      rejected.push({ candidateRef: candidate.candidateRef, reason: "human-owned capability vector does not satisfy TaskDemand" });
      continue;
    }
    passing.push({ candidate, capabilityScore, latency: observation.measuredLatencyMs, failureRate: observation.failureRate });
  }
  if (passing.length === 0)
    throw new RoutingSelectionError("No candidate satisfies the approved identity, A/B hard filters, and C operational binding", rejected);
  passing.sort(
    (left, right) =>
      right.capabilityScore - left.capabilityScore ||
      left.failureRate - right.failureRate ||
      left.latency - right.latency ||
      left.candidate.candidateRef.localeCompare(right.candidate.candidateRef),
  );
  const selected = passing[0]!;
  const pressure = classifyPressureBand(input.pressure);
  const candidateRefs = Object.freeze(passing.map(({ candidate }) => candidate.candidateRef));
  return Object.freeze({
    schemaVersion: ROUTING_DECISION_SCHEMA_VERSION,
    goalRef: input.goalRef,
    mode: input.mode,
    selectedCandidateRef: selected.candidate.candidateRef,
    selectedModelRef: selected.candidate.modelRef,
    accountBinding: selected.candidate.accountBinding,
    candidateRefs,
    rejected: Object.freeze(rejected),
    pressure,
    rationale: `Selected ${selected.candidate.modelRef} from ${passing.length} eligible candidate(s); pressure remains ${pressure.pressure} (${pressure.band}) and does not alter TaskDemand or authority.`,
  });
}
