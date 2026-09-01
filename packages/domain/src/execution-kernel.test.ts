import { describe, expect, it } from "vitest";
import { ExecutionKernelUnavailableError } from "./execution-kernel.js";

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
