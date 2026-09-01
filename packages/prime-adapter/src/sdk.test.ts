import { describe, expect, it } from "vitest";
import { assertPrimeSdkCompatibility, PINNED_PRIME_AGENT_VERSION } from "./sdk.js";

describe("assertPrimeSdkCompatibility", () => {
  it("accepts the pinned public Prime Agent SDK and required surfaces", async () => {
    await expect(assertPrimeSdkCompatibility()).resolves.toEqual({
      version: "0.8.0",
      supportsSessionFactory: true,
      supportsInMemorySessions: true,
    });
    expect(PINNED_PRIME_AGENT_VERSION).toBe("0.8.0");
  });
});
