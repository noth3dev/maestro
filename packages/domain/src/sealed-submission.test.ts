import { describe, expect, it } from "vitest";
import {
  InvalidSealedSubmissionSnapshotError,
  freezeSealedSubmissionSnapshot,
  sealedSubmissionSnapshotHash,
} from "./sealed-submission.js";

const validInput = () => ({
  projectId: "project-1",
  goalId: "goal-1",
  contract: {
    contractId: "contract-1",
    version: 2,
    contentHash: "a".repeat(64),
    content: { desiredOutcome: "ship it", constraints: ["bounded"] },
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
    expect(snapshot.deadline.toISOString()).toBe("2030-01-02T03:04:05.000Z");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.participants)).toBe(true);
    expect(Object.isFrozen(snapshot.contract.content)).toBe(true);
    expect(Object.isFrozen(snapshot.evidence)).toBe(true);
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
  });
});
