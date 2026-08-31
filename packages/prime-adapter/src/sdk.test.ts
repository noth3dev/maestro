import { describe, expect, it } from "vitest";
import { inspectPrimeSdk } from "./sdk.js";

describe("inspectPrimeSdk", () => {
  it("accepts the pinned public Prime Agent SDK", async () => {
    await expect(inspectPrimeSdk()).resolves.toEqual({
      version: "0.8.0",
      supportsSessionFactory: true,
      supportsInMemorySessions: true,
    });
  });

  it("fails closed when a different version is required", async () => {
    await expect(inspectPrimeSdk("9.9.9")).rejects.toThrow(
      "Unsupported Prime Agent SDK: expected 9.9.9, got 0.8.0",
    );
  });
});
