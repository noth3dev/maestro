import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";

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
  readonly deadline: Date;
}

export interface SealedSubmissionSnapshot {
  readonly projectId: string;
  readonly goalId: string;
  readonly contract: SealedSubmissionContract;
  readonly participants: readonly SealedSubmissionParticipant[];
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly deadline: Date;
  readonly snapshotHash: string;
}

export class InvalidSealedSubmissionSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSealedSubmissionSnapshotError"; }
}

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function assertPlainJsonValue(value: unknown, field: string): void {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidSealedSubmissionSnapshotError(`${field} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertPlainJsonValue(item, `${field}[${index}]`)); return; }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) throw new InvalidSealedSubmissionSnapshotError(`${field}.${key} must not be undefined`);
      assertPlainJsonValue(item, `${field}.${key}`);
    }
    return;
  }
  throw new InvalidSealedSubmissionSnapshotError(`${field} has an unsupported type`);
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
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = deepCopy(item);
    return result as unknown as T;
  }
  return value;
}

function assertValidInput(input: SealedSubmissionInput): void {
  if (typeof input.projectId !== "string" || input.projectId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("projectId is required");
  if (typeof input.goalId !== "string" || input.goalId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("goalId is required");
  if (!input.contract || typeof input.contract !== "object") throw new InvalidSealedSubmissionSnapshotError("contract is required");
  if (typeof input.contract.contractId !== "string" || input.contract.contractId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("contract.contractId is required");
  if (typeof input.contract.version !== "number" || !Number.isInteger(input.contract.version) || input.contract.version < 1) throw new InvalidSealedSubmissionSnapshotError("contract.version must be a positive integer");
  if (typeof input.contract.contentHash !== "string" || !CONTENT_HASH_PATTERN.test(input.contract.contentHash)) throw new InvalidSealedSubmissionSnapshotError("contract.contentHash must be a sha256 hex digest");
  assertPlainJsonValue(input.contract.content, "contract.content");
  if (!Array.isArray(input.participants) || input.participants.length === 0) throw new InvalidSealedSubmissionSnapshotError("participants must be a non-empty list");
  const seen = new Set<string>();
  for (const participant of input.participants) {
    if (typeof participant.participantId !== "string" || participant.participantId.trim() === "") throw new InvalidSealedSubmissionSnapshotError("participant.participantId is required");
    if (typeof participant.sessionRef !== "string" || participant.sessionRef.trim() === "") throw new InvalidSealedSubmissionSnapshotError("participant.sessionRef is required");
    if (seen.has(participant.participantId)) throw new InvalidSealedSubmissionSnapshotError(`Duplicate participant: ${participant.participantId}`);
    seen.add(participant.participantId);
  }
  assertPlainJsonValue(input.evidence, "evidence");
  if (!(input.deadline instanceof Date) || Number.isNaN(input.deadline.valueOf())) throw new InvalidSealedSubmissionSnapshotError("deadline must be a valid Date");
}

/**
 * Freezes an immutable, deep-copied snapshot of the frozen participant/session/contract/evidence
 * identity a sealed protocol round is bound to. Participant ordering is normalized so the same
 * logical submission always produces the same snapshotHash regardless of caller-supplied order.
 */
export function freezeSealedSubmissionSnapshot(input: SealedSubmissionInput): SealedSubmissionSnapshot {
  assertValidInput(input);
  const participants = deepCopy([...input.participants]).sort((a, b) => (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0));
  const snapshot: Omit<SealedSubmissionSnapshot, "snapshotHash"> = {
    projectId: input.projectId,
    goalId: input.goalId,
    contract: deepCopy(input.contract),
    participants,
    evidence: deepCopy(input.evidence),
    deadline: new Date(input.deadline.getTime()),
  };
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
    deadline: snapshot.deadline.toISOString(),
  })).digest("hex");
}

/** Recomputes the hash independently for external verification against a stored snapshot. */
export function sealedSubmissionSnapshotHash(snapshot: SealedSubmissionSnapshot): string {
  return computeSnapshotHash(snapshot);
}
