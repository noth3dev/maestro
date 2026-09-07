import { describe, expect, it } from "vitest";
import { ExecutionKernelUnavailableError, toExecutionRef, toInvocationRef } from "./execution-kernel.js";

describe("ExecutionKernelUnavailableError", () => {
  it("fails closed with the unavailable operation", () => {
    const error = new ExecutionKernelUnavailableError("resume");

    expect(error).toMatchObject({
      name: "ExecutionKernelUnavailableError",
      operation: "resume",
      code: "EXECUTION_KERNEL_UNAVAILABLE",
    });
  });
});


describe("opaque execution references", () => {
  it("accepts non-empty persisted references and rejects blank values", () => {
    expect(toExecutionRef("exec-1")).toBe("exec-1");
    expect(toInvocationRef("inv-1")).toBe("inv-1");
    expect(() => toExecutionRef(" ")).toThrow("Execution reference must be non-empty");
    expect(() => toInvocationRef(" ")).toThrow("Invocation reference must be non-empty");
  });
});
