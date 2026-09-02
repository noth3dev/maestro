import { createHash } from "node:crypto";
import { canonicalJson, taskContractContentHash } from "./task-contract.js";

/** Frozen, deep-copied inputs for the sealed-submission primitive shared by Head Council and future protocols. */

export interface SealedSubmissionParticipant {
  readonly participantId: string;
  readonly sessionRef: string;
}

export interface SealedSubmissionContract {
  readonly contractId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface SealedSubmissionInput {
  readonly projectId: string;
  readonly goalId: string;
  readonly contract: SealedSubmissionContract;
  readonly participants: readonly SealedSubmissionParticipant[];
  readonly evidence: Readonly<Record<string, unknown>>;
  /** Date is accepted at the boundary; snapshots expose only its canonical string. */
  readonly deadline: Date | string;
}

export interface SealedSubmissionSnapshot {
  readonly projectId: string;
  readonly goalId: string;
  readonly contract: SealedSubmissionContract;
  readonly participants: readonly SealedSubmissionParticipant[];
  readonly evidence: Readonly<Record<string, unknown>>;
  /** Canonical UTC timestamp. A mutable Date is never exposed as frozen state. */
  readonly deadline: string;
  readonly snapshotHash: string;
}

export class InvalidSealedSubmissionSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSealedSubmissionSnapshotError"; }
}

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ZONED_TIMESTAMP_PATTERN = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SNAPSHOT_FIELDS = ["projectId", "goalId", "contract", "participants", "evidence", "deadline", "snapshotHash"] as const;
const SNAPSHOT_FIELD_SET = new Set<string>(SNAPSHOT_FIELDS);
const DANGEROUS_JSON_KEYS = new Set(["__proto__", "prototype"]);

type JsonRecord = Record<string, unknown>;

function assertSafeJsonKey(key: string, field: string): void {
  if (DANGEROUS_JSON_KEYS.has(key)) throw new InvalidSealedSubmissionSnapshotError(`${field} has dangerous JSON key ${key}`);
}

function isPlainObject(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataValue(value: object, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw new InvalidSealedSubmissionSnapshotError(`${field} is required`);
  return descriptor.value;
}

/**
 * Validates the object-property shape that JSON can represent. Accessors,
 * symbols, hidden properties, and prototype-pollution keys are not JSON data.
 */
function assertJsonRecordShape(value: object, field: string): string[] {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new InvalidSealedSubmissionSnapshotError(`${field} must contain only plain JSON values`);
  }
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string") throw new InvalidSealedSubmissionSnapshotError(`${field} has an unsupported JSON key`);
    assertSafeJsonKey(key, field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new InvalidSealedSubmissionSnapshotError(`${field}.${key} must be a data property`);
    if (!descriptor.enumerable) throw new InvalidSealedSubmissionSnapshotError(`${field}.${key} must be enumerable`);
    stringKeys.push(key);
  }
  return stringKeys;
}

function arrayIndex(key: string): number | undefined {
  if (key === "0") return 0;
  if (!/^[1-9]\d*$/.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < 2 ** 32 - 1 ? index : undefined;
}

function assertPlainJsonValue(value: unknown, field: string, ancestors = new Set<object>()): void {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must be a finite number`);
    return;
  }
  if (typeof value !== "object") throw new InvalidSealedSubmissionSnapshotError(`${field} has an unsupported type`);

  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must not contain cycles`);
    ancestors.add(value);
    try {
      let keys: PropertyKey[];
      try {
        keys = Reflect.ownKeys(value);
      } catch {
        throw new InvalidSealedSubmissionSnapshotError(`${field} must contain only plain JSON values`);
      }
      const indices: number[] = [];
      for (const key of keys) {
        if (typeof key !== "string") throw new InvalidSealedSubmissionSnapshotError(`${field} has an unsupported JSON key`);
        if (key === "length") continue;
        assertSafeJsonKey(key, field);
        const index = arrayIndex(key);
        if (index === undefined) throw new InvalidSealedSubmissionSnapshotError(`${field} has an unsupported array property ${key}`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) throw new InvalidSealedSubmissionSnapshotError(`${field}[${key}] must be a data property`);
        if (!descriptor.enumerable) throw new InvalidSealedSubmissionSnapshotError(`${field}[${key}] must be enumerable`);
        indices.push(index);
      }
      indices.sort((left, right) => left - right);
      if (indices.length !== value.length || indices.some((index, position) => index !== position)) {
        throw new InvalidSealedSubmissionSnapshotError(`${field} must be a dense, non-sparse array`);
      }
      for (const index of indices) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        assertPlainJsonValue(descriptor && "value" in descriptor ? descriptor.value : undefined, `${field}[${index}]`, ancestors);
      }
    } finally {
      ancestors.delete(value);
    }
    return;
  }

  if (value instanceof Date || !isPlainObject(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must contain only plain JSON values`);
  if (ancestors.has(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must not contain cycles`);
  ancestors.add(value);
  try {
    for (const key of assertJsonRecordShape(value, field)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assertPlainJsonValue(descriptor && "value" in descriptor ? descriptor.value : undefined, `${field}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

/** Safe clone for the validated JSON subset. Null-prototype records avoid inherited mutable state. */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    const result = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      result[index] = deepCopy(descriptor && "value" in descriptor ? descriptor.value : undefined);
    }
    return result as T;
  }
  if (value !== null && typeof value === "object") {
    const result = Object.create(null) as JsonRecord;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: deepCopy(descriptor && "value" in descriptor ? descriptor.value : undefined),
        writable: true,
      });
    }
    return result as T;
  }
  return value;
}

function canonicalDeadline(value: Date | string): string {
  if (!(value instanceof Date) && typeof value !== "string") throw new InvalidSealedSubmissionSnapshotError("deadline must be a valid timestamp");
  if (typeof value === "string" && !ZONED_TIMESTAMP_PATTERN.test(value)) {
    throw new InvalidSealedSubmissionSnapshotError("deadline must be an ISO timestamp with an explicit timezone");
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new InvalidSealedSubmissionSnapshotError("deadline must be a valid timestamp");
  return date.toISOString();
}

function assertObject(value: unknown, field: string): asserts value is JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date || !isPlainObject(value)) {
    throw new InvalidSealedSubmissionSnapshotError(`${field} must be a plain object`);
  }
}

function assertValidInput(input: unknown): asserts input is SealedSubmissionInput {
  assertObject(input, "input");
  assertJsonRecordShape(input, "input");

  const projectId = ownDataValue(input, "projectId", "projectId");
  if (typeof projectId !== "string" || projectId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("projectId is required");
  const goalId = ownDataValue(input, "goalId", "goalId");
  if (typeof goalId !== "string" || goalId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("goalId is required");

  const contract = ownDataValue(input, "contract", "contract");
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) throw new InvalidSealedSubmissionSnapshotError("contract is required");
  assertPlainJsonValue(contract, "contract");
  assertObject(contract, "contract");
  const contractId = ownDataValue(contract, "contractId", "contract.contractId");
  if (typeof contractId !== "string" || contractId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("contract.contractId is required");
  const version = ownDataValue(contract, "version", "contract.version");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new InvalidSealedSubmissionSnapshotError("contract.version must be a positive integer");
  const contentHash = ownDataValue(contract, "contentHash", "contract.contentHash");
  if (typeof contentHash !== "string" || !CONTENT_HASH_PATTERN.test(contentHash)) throw new InvalidSealedSubmissionSnapshotError("contract.contentHash must be a sha256 hex digest");
  const content = ownDataValue(contract, "content", "contract.content");
  assertObject(content, "contract.content");
  if (taskContractContentHash(content as never) !== contentHash) throw new InvalidSealedSubmissionSnapshotError("contract content hash mismatch");

  const participants = ownDataValue(input, "participants", "participants");
  if (!Array.isArray(participants) || participants.length === 0) throw new InvalidSealedSubmissionSnapshotError("participants must be a non-empty list");
  assertPlainJsonValue(participants, "participants");
  const seen = new Set<string>();
  for (const participant of participants) {
    assertObject(participant, "participant");
    const participantId = ownDataValue(participant, "participantId", "participant.participantId");
    if (typeof participantId !== "string" || participantId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("participant.participantId is required");
    const sessionRef = ownDataValue(participant, "sessionRef", "participant.sessionRef");
    if (typeof sessionRef !== "string" || sessionRef.trim() === "") throw new InvalidSealedSubmissionSnapshotError("participant.sessionRef is required");
    if (seen.has(participantId)) throw new InvalidSealedSubmissionSnapshotError(`Duplicate participant: ${participantId}`);
    seen.add(participantId);
  }

  const evidence = ownDataValue(input, "evidence", "evidence");
  assertObject(evidence, "evidence");
  assertPlainJsonValue(evidence, "evidence");
  canonicalDeadline(ownDataValue(input, "deadline", "deadline") as Date | string);
}

function assertValidSnapshot(value: unknown): asserts value is SealedSubmissionSnapshot {
  assertObject(value, "snapshot");
  const keys = assertJsonRecordShape(value, "snapshot");
  for (const key of keys) if (!SNAPSHOT_FIELD_SET.has(key)) throw new InvalidSealedSubmissionSnapshotError(`snapshot has unknown field ${key}`);
  const snapshotHash = ownDataValue(value, "snapshotHash", "snapshot.snapshotHash");
  if (typeof snapshotHash !== "string" || !CONTENT_HASH_PATTERN.test(snapshotHash)) throw new InvalidSealedSubmissionSnapshotError("snapshot.snapshotHash is invalid");
  const deadline = ownDataValue(value, "deadline", "snapshot.deadline");
  if (typeof deadline !== "string" || canonicalDeadline(deadline) !== deadline) throw new InvalidSealedSubmissionSnapshotError("snapshot.deadline must be a canonical UTC timestamp");
  assertValidInput({
    projectId: ownDataValue(value, "projectId", "snapshot.projectId"),
    goalId: ownDataValue(value, "goalId", "snapshot.goalId"),
    contract: ownDataValue(value, "contract", "snapshot.contract"),
    participants: ownDataValue(value, "participants", "snapshot.participants"),
    evidence: ownDataValue(value, "evidence", "snapshot.evidence"),
    deadline,
  });
}

function snapshotCore(input: SealedSubmissionInput): Omit<SealedSubmissionSnapshot, "snapshotHash"> {
  const participants = deepCopy(input.participants) as SealedSubmissionParticipant[];
  participants.sort((a, b) => (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0));
  return {
    projectId: input.projectId,
    goalId: input.goalId,
    contract: deepCopy(input.contract),
    participants,
    evidence: deepCopy(input.evidence),
    deadline: canonicalDeadline(input.deadline),
  };
}

/**
 * Freezes an immutable, deep-copied snapshot of the frozen participant/session/contract/evidence
 * identity a sealed protocol round is bound to. Participant ordering is normalized so the same
 * logical submission always produces the same snapshotHash regardless of caller-supplied order.
 */
export function freezeSealedSubmissionSnapshot(input: SealedSubmissionInput): SealedSubmissionSnapshot {
  assertValidInput(input);
  const snapshot = snapshotCore(input);
  const snapshotHash = computeSnapshotHash(snapshot);
  return deepFreeze({ ...snapshot, snapshotHash });
}

function computeSnapshotHash(snapshot: Omit<SealedSubmissionSnapshot, "snapshotHash">): string {
  return createHash("sha256").update(canonicalJson({
    projectId: snapshot.projectId,
    goalId: snapshot.goalId,
    contract: snapshot.contract,
    participants: snapshot.participants,
    evidence: snapshot.evidence,
    deadline: snapshot.deadline,
  })).digest("hex");
}

/** Recomputes the hash independently for external verification against a stored snapshot. */
export function sealedSubmissionSnapshotHash(snapshot: SealedSubmissionSnapshot): string {
  assertValidSnapshot(snapshot);
  return computeSnapshotHash({
    projectId: snapshot.projectId,
    goalId: snapshot.goalId,
    contract: snapshot.contract,
    participants: snapshot.participants,
    evidence: snapshot.evidence,
    deadline: snapshot.deadline,
  });
}

/** Hydrates a persisted JSON payload and fails closed if its identity is not intact. */
export function hydrateSealedSubmissionSnapshot(value: unknown, expectedHash?: string): SealedSubmissionSnapshot {
  assertValidSnapshot(value);
  const snapshot = freezeSealedSubmissionSnapshot({
    projectId: value.projectId,
    goalId: value.goalId,
    contract: value.contract,
    participants: value.participants,
    evidence: value.evidence,
    deadline: value.deadline,
  });
  if (snapshot.snapshotHash !== value.snapshotHash || (expectedHash !== undefined && snapshot.snapshotHash !== expectedHash)) {
    throw new InvalidSealedSubmissionSnapshotError("stored snapshot hash mismatch");
  }
  return snapshot;
}
