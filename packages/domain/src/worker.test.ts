import { describe, expect, it } from "vitest";
import { assertValidWorkerTransition, InvalidWorkerTransitionError } from "./worker.js";

describe("Worker lifecycle transitions", () => {
  it("allows non-terminal to non-terminal or terminal transitions", () => {
    expect(() => assertValidWorkerTransition("spawned", "running")).not.toThrow();
    expect(() => assertValidWorkerTransition("running", "succeeded")).not.toThrow();
    expect(() => assertValidWorkerTransition("spawned", "cancelled")).not.toThrow();
  });

  it("allows a terminal state to repeat itself (idempotent observation)", () => {
    expect(() => assertValidWorkerTransition("succeeded", "succeeded")).not.toThrow();
  });

  it("rejects leaving a terminal state", () => {
    expect(() => assertValidWorkerTransition("succeeded", "failed")).toThrow(InvalidWorkerTransitionError);
    expect(() => assertValidWorkerTransition("cancelled", "running")).toThrow(InvalidWorkerTransitionError);
  });
});
