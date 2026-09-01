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
const SNAPSHOT_FIELDS = ["projectId", "goalId", "contract", "participants", "evidence", "deadline", "snapshotHash"] as const;

function assertPlainJsonValue(value: unknown, field: string): void {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertPlainJsonValue(item, `${field}[${index}]`)); return; }
  if (typeof value === "object") {
    if (value instanceof Date || !isPlainObject(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must contain only plain JSON values`);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) throw new InvalidSealedSubmissionSnapshotError(`${field}.${key} must not be undefined`);
      assertPlainJsonValue(item, `${field}.${key}`);
    }
    return;
  }
  throw new InvalidSealedSubmissionSnapshotError(`${field} has an unsupported type`);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** Cheap, dependency-free deep copy sufficient for plain-JSON snapshot payloads. */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = deepCopy(item);
    return result as unknown as T;
  }
  return value;
}

function canonicalDeadline(value: Date | string): string {
  if (!(value instanceof Date) && typeof value !== "string") throw new InvalidSealedSubmissionSnapshotError("deadline must be a valid timestamp");
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new InvalidSealedSubmissionSnapshotError("deadline must be a valid timestamp");
  return date.toISOString();
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date || !isPlainObject(value)) {
    throw new InvalidSealedSubmissionSnapshotError(`${field} must be a plain object`);
  }
}

function assertValidInput(input: SealedSubmissionInput): void {
  if (typeof input.projectId !== "string" || input.projectId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("projectId is required");
  if (typeof input.goalId !== "string" || input.goalId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("goalId is required");
  if (!input.contract || typeof input.contract !== "object" || Array.isArray(input.contract)) throw new InvalidSealedSubmissionSnapshotError("contract is required");
  if (typeof input.contract.contractId !== "string" || input.contract.contractId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("contract.contractId is required");
  if (typeof input.contract.version !== "number" || !Number.isInteger(input.contract.version) || input.contract.version < 1) throw new InvalidSealedSubmissionSnapshotError("contract.version must be a positive integer");
  if (typeof input.contract.contentHash !== "string" || !CONTENT_HASH_PATTERN.test(input.contract.contentHash)) throw new InvalidSealedSubmissionSnapshotError("contract.contentHash must be a sha256 hex digest");
  assertObject(input.contract.content, "contract.content");
  assertPlainJsonValue(input.contract.content, "contract.content");
  if (taskContractContentHash(input.contract.content as never) !== input.contract.contentHash) throw new InvalidSealedSubmissionSnapshotError("contract content hash mismatch");
  if (!Array.isArray(input.participants) || input.participants.length === 0) throw new InvalidSealedSubmissionSnapshotError("participants must be a non-empty list");
  const seen = new Set<string>();
  for (const participant of input.participants) {
    if (!participant || typeof participant !== "object" || Array.isArray(participant) || !isPlainObject(participant)) throw new InvalidSealedSubmissionSnapshotError("participant must be a plain object");
    if (typeof participant.participantId !== "string" || participant.participantId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("participant.participantId is required");
    if (typeof participant.sessionRef !== "string" || participant.sessionRef.trim() === "") throw new InvalidSealedSubmissionSnapshotError("participant.sessionRef is required");
    if (seen.has(participant.participantId)) throw new InvalidSealedSubmissionSnapshotError(`Duplicate participant: ${participant.participantId}`);
    seen.add(participant.participantId);
  }
  assertObject(input.evidence, "evidence");
  assertPlainJsonValue(input.evidence, "evidence");
  canonicalDeadline(input.deadline);
}

function snapshotCore(input: SealedSubmissionInput): Omit<SealedSubmissionSnapshot, "snapshotHash"> {
  const participants = deepCopy([...input.participants]).sort((a, b) => (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0));
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
  assertObject(value, "snapshot");
  for (const key of Object.keys(value)) if (!(SNAPSHOT_FIELDS as readonly string[]).includes(key)) throw new InvalidSealedSubmissionSnapshotError(`snapshot has unknown field ${key}`);
  if (typeof value.snapshotHash !== "string" || !CONTENT_HASH_PATTERN.test(value.snapshotHash)) throw new InvalidSealedSubmissionSnapshotError("snapshot.snapshotHash is invalid");
  const snapshot = freezeSealedSubmissionSnapshot({
    projectId: value.projectId as string,
    goalId: value.goalId as string,
    contract: value.contract as SealedSubmissionContract,
    participants: value.participants as readonly SealedSubmissionParticipant[],
    evidence: value.evidence as Readonly<Record<string, unknown>>,
    deadline: value.deadline as string,
  });
  if (snapshot.snapshotHash !== value.snapshotHash || (expectedHash !== undefined && snapshot.snapshotHash !== expectedHash)) {
    throw new InvalidSealedSubmissionSnapshotError("stored snapshot hash mismatch");
  }
  return snapshot;
}
