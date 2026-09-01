import { describe, expect, it } from "vitest";
import { assertResolverIsNotSentinel, assertValidSentinelChallengeSubstance, InvalidSentinelChallengeError, SENTINEL_ACTOR_ID } from "./sentinel-challenge.js";

describe("Sentinel challenge", () => {
  it("accepts a valid substance", () => {
    expect(() => assertValidSentinelChallengeSubstance({ reason: "unsupported claim", evidenceReferences: ["ev-1"] })).not.toThrow();
  });
  it("rejects an unknown field", () => {
    expect(() => assertValidSentinelChallengeSubstance({ reason: "x", evidenceReferences: [], extra: 1 })).toThrow(InvalidSentinelChallengeError);
  });
  it("rejects a blank reason", () => {
    expect(() => assertValidSentinelChallengeSubstance({ reason: "", evidenceReferences: [] })).toThrow(InvalidSentinelChallengeError);
  });
  it("rejects Sentinel resolving its own challenge", () => {
    expect(() => assertResolverIsNotSentinel(SENTINEL_ACTOR_ID)).toThrow(InvalidSentinelChallengeError);
  });
  it("allows a non-Sentinel actor to resolve", () => {
    expect(() => assertResolverIsNotSentinel("head:product")).not.toThrow();
  });
});
