import { assertValidModelCapabilityVector, type ModelCapabilityVector } from "./model-profile.js";
import { assertValidProviderFacts, type ProviderFacts } from "./provider-facts.js";

export const MODEL_MAP_SCHEMA_VERSION = 1 as const;

export interface ModelMapProvenance {
  readonly owner: "human";
  readonly sourceRefs: readonly string[];
  readonly reviewedAt: string;
}

export interface ModelMapEntry {
  readonly modelRef: string;
  readonly capability: ModelCapabilityVector;
  readonly providerFacts: ProviderFacts;
  readonly provenance: ModelMapProvenance;
}

export interface ModelMap {
  readonly schemaVersion: typeof MODEL_MAP_SCHEMA_VERSION;
  readonly entries: readonly ModelMapEntry[];
}

export class ModelMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelMapValidationError";
  }
}

type DataObject = Record<string, unknown>;

function object(value: unknown, name: string): asserts value is DataObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ModelMapValidationError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ModelMapValidationError(`${name} must be a plain object`);
}

function ownDataProperties(value: unknown, allowed: readonly string[], name: string): DataObject {
  object(value, name);
  const result: DataObject = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw new ModelMapValidationError(`${name} has unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new ModelMapValidationError(`${name} field ${key} must be an enumerable data property`);
    result[key] = descriptor.value;
  }
  return result;
}

function required(value: DataObject, fields: readonly string[], name: string): void {
  for (const field of fields) if (!Object.hasOwn(value, field)) throw new ModelMapValidationError(`${name} field ${field} is required`);
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value))
    throw new ModelMapValidationError(`${field} must be a non-empty single line`);
}

function lines(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || Object.getPrototypeOf(value) !== Array.prototype)
    throw new ModelMapValidationError(`${field} must be a non-empty array`);
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new ModelMapValidationError(`${field} must not be sparse`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new ModelMapValidationError(`${field} entries must be enumerable data properties`);
    line(value[index], `${field}[${index}]`);
    if (seen.has(value[index])) throw new ModelMapValidationError(`${field} must not contain duplicates`);
    seen.add(value[index]);
  }
}

function validateModelRef(value: unknown): asserts value is string {
  line(value, "Model map modelRef");
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1 || value.indexOf("/", separator + 1) !== -1 || /\s/.test(value)) {
    throw new ModelMapValidationError("Model map modelRef must be an exact provider/model identity");
  }
}

function validateEntry(value: unknown, index: number): ModelMapEntry {
  const entry = ownDataProperties(value, ["modelRef", "capability", "providerFacts", "provenance"], `Model map entry ${index}`);
  required(entry, ["modelRef", "capability", "providerFacts", "provenance"], `Model map entry ${index}`);
  validateModelRef(entry.modelRef);
  try {
    assertValidModelCapabilityVector(entry.capability);
    assertValidProviderFacts(entry.providerFacts);
  } catch (error) {
    throw new ModelMapValidationError(
      `Model map entry ${index} contains invalid A/B facts: ${error instanceof Error ? error.message : "unreadable value"}`,
    );
  }
  const provenance = ownDataProperties(entry.provenance, ["owner", "sourceRefs", "reviewedAt"], `Model map entry ${index} provenance`);
  required(provenance, ["owner", "sourceRefs", "reviewedAt"], `Model map entry ${index} provenance`);
  if (provenance.owner !== "human") throw new ModelMapValidationError("Model map provenance owner must be human");
  lines(provenance.sourceRefs, `Model map entry ${index} provenance sourceRefs`);
  line(provenance.reviewedAt, `Model map entry ${index} provenance reviewedAt`);
  return entry as unknown as ModelMapEntry;
}

export function assertValidModelMap(value: unknown): asserts value is ModelMap {
  const map = ownDataProperties(value, ["schemaVersion", "entries"], "Model map");
  required(map, ["schemaVersion", "entries"], "Model map");
  if (map.schemaVersion !== MODEL_MAP_SCHEMA_VERSION)
    throw new ModelMapValidationError(`Model map schemaVersion must be ${MODEL_MAP_SCHEMA_VERSION}`);
  if (!Array.isArray(map.entries) || Object.getPrototypeOf(map.entries) !== Array.prototype)
    throw new ModelMapValidationError("Model map entries must be a standard Array");
  const refs = new Set<string>();
  for (let index = 0; index < map.entries.length; index += 1) {
    if (!Object.hasOwn(map.entries, index)) throw new ModelMapValidationError("Model map entries must not be sparse");
    const entry = validateEntry(map.entries[index], index);
    if (refs.has(entry.modelRef)) throw new ModelMapValidationError(`Model map contains duplicate modelRef: ${entry.modelRef}`);
    refs.add(entry.modelRef);
  }
}
