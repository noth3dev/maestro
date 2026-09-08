import { describe, expect, it } from "vitest";
import { ExecutionKernelUnavailableError, toExecutionRef, toInvocationRef } from "./execution-kernel.js";

describe("canonical outbound data classes", () => {
  it("maps legacy Mission Bundle boundary labels to host result classes", async () => {
    const { canonicalOutboundDataClasses } = await import("./execution-kernel.js");
    expect(canonicalOutboundDataClasses(["repository files only", "repository"])).toEqual(["workspace"]);
    expect(canonicalOutboundDataClasses(["customer PII", "public reports"])).toEqual(["pii", "public"]);
  });

  it("rejects unknown and negative boundary labels instead of widening authority", async () => {
    const { canonicalOutboundDataClasses } = await import("./execution-kernel.js");
    expect(canonicalOutboundDataClasses(["some unclassified boundary", "no repository files", "no token disclosure"])).toEqual([]);
    expect(canonicalOutboundDataClasses(["repository files only", "no repository files"])).toEqual([]);
  });
});

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
