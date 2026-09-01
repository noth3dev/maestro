import { describe, expect, it } from "vitest";
import {
  InvalidSealedSubmissionSnapshotError,
  freezeSealedSubmissionSnapshot,
  hydrateSealedSubmissionSnapshot,
  sealedSubmissionSnapshotHash,
} from "./sealed-submission.js";
import { taskContractContentHash } from "./task-contract.js";

const validInput = () => ({
  projectId: "project-1",
  goalId: "goal-1",
  contract: {
    contractId: "contract-1",
    version: 2,
    content: { desiredOutcome: "ship it", constraints: ["bounded"] },
    contentHash: taskContractContentHash({ desiredOutcome: "ship it", constraints: ["bounded"] } as never),
  },
  participants: [
    { participantId: "head-a", sessionRef: "session-a" },
    { participantId: "head-b", sessionRef: "session-b" },
  ],
  evidence: { source: "brief", references: ["evidence-1"] },
  deadline: new Date("2030-01-02T03:04:05.000Z"),
});

describe("sealed submission snapshots", () => {
  it("deep-copies and freezes participant, session, contract, and evidence input", () => {
    const input = validInput();
    const snapshot = freezeSealedSubmissionSnapshot(input);
    input.participants[0]!.sessionRef = "mutated";
    input.contract.content.desiredOutcome = "mutated";
    input.evidence.references[0] = "mutated";
    input.deadline.setUTCFullYear(2040);

    expect(snapshot.participants[0]!.sessionRef).toBe("session-a");
    expect(snapshot.contract.content.desiredOutcome).toBe("ship it");
    expect(snapshot.evidence.references[0]).toBe("evidence-1");
    expect(snapshot.deadline).toBe("2030-01-02T03:04:05.000Z");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.participants)).toBe(true);
    expect(Object.isFrozen(snapshot.contract.content)).toBe(true);
    expect(Object.isFrozen(snapshot.evidence)).toBe(true);
  });

  it("persists a canonical payload whose hash verifies after JSON round-trip", () => {
    const snapshot = freezeSealedSubmissionSnapshot(validInput());
    const persisted = JSON.parse(JSON.stringify(snapshot));
    expect(typeof snapshot.deadline).toBe("string");
    expect(sealedSubmissionSnapshotHash(persisted)).toBe(snapshot.snapshotHash);
    expect(hydrateSealedSubmissionSnapshot(persisted, snapshot.snapshotHash)).toEqual(snapshot);
    expect(persisted.contract.contentHash).toBe(snapshot.contract.contentHash);
    expect(persisted.participants).toEqual(snapshot.participants);
    expect(persisted.evidence).toEqual(snapshot.evidence);
    persisted.evidence.references[0] = "tampered";
    expect(() => hydrateSealedSubmissionSnapshot(persisted, snapshot.snapshotHash)).toThrow(/hash mismatch/);
  });

  it("normalizes participant ordering into one stable snapshot hash", () => {
    const first = freezeSealedSubmissionSnapshot(validInput());
    const input = validInput();
    input.participants.reverse();
    const second = freezeSealedSubmissionSnapshot(input);
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(sealedSubmissionSnapshotHash(first)).toBe(first.snapshotHash);
  });

  it("rejects duplicate participants and malformed JSON values", () => {
    const duplicate = validInput();
    duplicate.participants.push({ participantId: "head-a", sessionRef: "other" });
    expect(() => freezeSealedSubmissionSnapshot(duplicate)).toThrow(InvalidSealedSubmissionSnapshotError);

    const malformed = validInput();
    (malformed.evidence as Record<string, unknown>).bad = undefined;
    expect(() => freezeSealedSubmissionSnapshot(malformed)).toThrow(InvalidSealedSubmissionSnapshotError);
  });

  it("rejects non-finite evidence numbers and invalid contract identity", () => {
    const nonFinite = validInput();
    (nonFinite.evidence as Record<string, unknown>).bad = Number.NaN;
    expect(() => freezeSealedSubmissionSnapshot(nonFinite)).toThrow(InvalidSealedSubmissionSnapshotError);

    const invalidContract = validInput();
    invalidContract.contract.contentHash = "not-a-hash";
    expect(() => freezeSealedSubmissionSnapshot(invalidContract)).toThrow(InvalidSealedSubmissionSnapshotError);

    const mismatchedContract = validInput();
    mismatchedContract.contract.contentHash = "a".repeat(64);
    expect(() => freezeSealedSubmissionSnapshot(mismatchedContract)).toThrow(/content hash mismatch/);
  });
});
