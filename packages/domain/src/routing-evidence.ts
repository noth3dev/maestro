import { classifyPressureBand } from "./pressure-band.js";

export const ROUTING_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const ROUTING_MODES = Object.freeze(["ensemble", "pin"] as const);
export type RoutingMode = (typeof ROUTING_MODES)[number];
export const ROUTING_EVIDENCE_BANDS = Object.freeze(["low", "medium", "high", "critical"] as const);
export type RoutingEvidenceBand = (typeof ROUTING_EVIDENCE_BANDS)[number];

export interface RoutingEvidenceRejection {
  readonly candidateRef: string;
  readonly reason: string;
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
  readonly rejections: readonly RoutingEvidenceRejection[];
  readonly taskDemandHash: string;
  readonly pressure: number;
  readonly pressureBand: RoutingEvidenceBand;
  readonly decisionLayer: "automatic progress" | "Department Head" | "Encore Council" | "user";
  readonly overlayVersion: number | null;
  readonly admissionBindingRef: string;
  readonly rationale: string;
  readonly createdAt: string;
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
function list(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RoutingEvidenceValidationError(`${field} must be a non-empty array`);
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i) || typeof value[i] !== "string" || value[i].trim() === "" || /[\r\n]/.test(value[i]))
      throw new RoutingEvidenceValidationError(`${field} contains an invalid value`);
    if (seen.has(value[i])) throw new RoutingEvidenceValidationError(`${field} must not contain duplicates`);
    seen.add(value[i]);
  }
}
function rejectionList(value: unknown, field: string): asserts value is readonly RoutingEvidenceRejection[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RoutingEvidenceValidationError(`${field} must be a standard Array`);
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
  if (!Number.isFinite(Date.parse(value))) throw new RoutingEvidenceValidationError(`${field} must be a valid timestamp`);
}
function modelRef(value: unknown): asserts value is string {
  ref(value, "selectedModelRef");
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || value.indexOf("/", slash + 1) !== -1)
    throw new RoutingEvidenceValidationError("selectedModelRef must be provider-qualified");
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
      "rejections",
      "taskDemandHash",
      "pressure",
      "pressureBand",
      "decisionLayer",
      "overlayVersion",
      "admissionBindingRef",
      "rationale",
      "createdAt",
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
      "rejections",
      "taskDemandHash",
      "pressure",
      "pressureBand",
      "decisionLayer",
      "overlayVersion",
      "admissionBindingRef",
      "rationale",
      "createdAt",
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
  if (
    record.overlayVersion !== null &&
    (typeof record.overlayVersion !== "number" || !Number.isSafeInteger(record.overlayVersion) || record.overlayVersion < 1)
  )
    throw new RoutingEvidenceValidationError("Routing evidence overlayVersion is invalid");
  timestamp(record.createdAt, "Routing evidence createdAt");
}
