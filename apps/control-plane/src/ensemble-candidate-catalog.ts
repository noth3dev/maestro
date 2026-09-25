import { readFileSync } from "node:fs";
import { assertValidModelMap, type ModelMap, type RouterCandidate } from "@maestro/domain";

export interface RoutingCandidateCatalogPaths {
  readonly modelMapPath: string;
  readonly catalogPath: string;
}

export interface RoutingCandidateCatalog {
  readonly modelMap: ModelMap;
  readonly candidates: readonly RouterCandidate[];
}

export class RoutingCandidateCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingCandidateCatalogError";
  }
}

type DataObject = Record<string, unknown>;

function object(value: unknown, name: string): asserts value is DataObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoutingCandidateCatalogError(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RoutingCandidateCatalogError(`${name} must be a plain object`);
  }
}

function ownDataProperties(value: DataObject, allowed: readonly string[], name: string): DataObject {
  const result: DataObject = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new RoutingCandidateCatalogError(`${name} has unknown field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new RoutingCandidateCatalogError(`${name} field ${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function required(value: DataObject, fields: readonly string[], name: string): void {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new RoutingCandidateCatalogError(`${name} field ${field} is required`);
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new RoutingCandidateCatalogError(`${field} must be a non-empty single line`);
  }
}

function modelRef(value: unknown, field: string): asserts value is string {
  line(value, field);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || value.indexOf("/", slash + 1) !== -1 || /\s/.test(value)) {
    throw new RoutingCandidateCatalogError(`${field} must be an exact provider/model identity`);
  }
}

function candidateRef(value: unknown, field: string): asserts value is string {
  line(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) {
    throw new RoutingCandidateCatalogError(`${field} must be an opaque candidate reference`);
  }
}

function parseJsonFile(path: string, name: string): unknown {
  line(path, `${name} path`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoutingCandidateCatalogError(`${name} could not be read as JSON: ${error instanceof Error ? error.message : "unreadable file"}`);
  }
}

function parseModelMap(value: unknown): ModelMap {
  try {
    assertValidModelMap(value);
  } catch (error) {
    throw new RoutingCandidateCatalogError(`Human-owned model_map is invalid: ${error instanceof Error ? error.message : "unreadable value"}`);
  }
  return value as ModelMap;
}

function parseCandidates(value: unknown, modelMap: ModelMap): readonly RouterCandidate[] {
  object(value, "Candidate catalog");
  const catalog = ownDataProperties(value, ["schemaVersion", "entries"], "Candidate catalog");
  required(catalog, ["schemaVersion", "entries"], "Candidate catalog");
  if (catalog.schemaVersion !== 1) throw new RoutingCandidateCatalogError("Candidate catalog schemaVersion must be 1");
  if (!Array.isArray(catalog.entries) || Object.getPrototypeOf(catalog.entries) !== Array.prototype) {
    throw new RoutingCandidateCatalogError("Candidate catalog entries must be a standard Array");
  }
  const knownModels = new Set(modelMap.entries.map((entry) => entry.modelRef));
  const refs = new Set<string>();
  return Object.freeze(catalog.entries.map((raw, index) => {
    object(raw, `Candidate catalog entry ${index}`);
    const entry = ownDataProperties(raw, ["candidateRef", "modelRef", "accountBinding"], `Candidate catalog entry ${index}`);
    required(entry, ["candidateRef", "modelRef", "accountBinding"], `Candidate catalog entry ${index}`);
    candidateRef(entry.candidateRef, `Candidate catalog entry ${index} candidateRef`);
    modelRef(entry.modelRef, `Candidate catalog entry ${index} modelRef`);
    line(entry.accountBinding, `Candidate catalog entry ${index} accountBinding`);
    if (refs.has(entry.candidateRef)) throw new RoutingCandidateCatalogError(`Candidate catalog contains duplicate candidateRef: ${entry.candidateRef}`);
    if (!knownModels.has(entry.modelRef)) throw new RoutingCandidateCatalogError(`Candidate catalog modelRef is absent from human-owned model_map: ${entry.modelRef}`);
    refs.add(entry.candidateRef);
    return { candidateRef: entry.candidateRef, modelRef: entry.modelRef, accountBinding: entry.accountBinding } satisfies RouterCandidate;
  }));
}

export function readRoutingModelMap(modelMapPath: string): ModelMap {
  return parseModelMap(parseJsonFile(modelMapPath, "model_map"));
}

/**
 * Zero-config candidate set: every live Gateway model that already has a
 * human-owned model_map profile and whose provider has an operator account
 * binding. Unprofiled live models stay out of routing; identities are exact,
 * so `openai/*` and `openai-codex/*` never stand in for each other.
 */
export function deriveRoutingCandidates(input: {
  readonly modelMap: ModelMap;
  readonly liveModelRefs: Iterable<string>;
  readonly accountRefs: Readonly<Record<string, string>>;
}): readonly RouterCandidate[] {
  const profiled = new Set(input.modelMap.entries.map((entry) => entry.modelRef));
  const candidates: RouterCandidate[] = [];
  for (const ref of new Set(input.liveModelRefs)) {
    const separator = ref.indexOf("/");
    if (separator <= 0 || !profiled.has(ref)) continue;
    const provider = ref.slice(0, separator);
    const accountBinding = Object.hasOwn(input.accountRefs, provider) ? input.accountRefs[provider] : undefined;
    if (accountBinding === undefined) continue;
    candidates.push({ candidateRef: `${provider}:${ref.slice(separator + 1)}`, modelRef: ref, accountBinding });
  }
  return Object.freeze(candidates);
}

/**
 * Read only the human-owned model map and an explicit candidate identity catalog.
 * Candidate references are never derived from model names, and this function
 * never writes either file.
 */
export function readRoutingCandidateCatalog(paths: RoutingCandidateCatalogPaths): RoutingCandidateCatalog {
  const modelMap = readRoutingModelMap(paths.modelMapPath);
  const candidates = parseCandidates(parseJsonFile(paths.catalogPath, "Candidate catalog"), modelMap);
  return Object.freeze({ modelMap, candidates });
}
