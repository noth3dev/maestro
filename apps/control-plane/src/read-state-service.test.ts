import { describe, expect, it } from "vitest";
import { isArrangementActive } from "./read-state-service.js";

describe("Arrangements active projection", () => {
  it("treats a certified rollout that still points at the applied candidate as active", () => {
    expect(isArrangementActive({
      candidate: { candidateId: "candidate-1", version: 2 },
      rollout: { status: "certified", activeCandidateId: "candidate-1", activeVersion: 2 },
    })).toBe(true);
  });
});
