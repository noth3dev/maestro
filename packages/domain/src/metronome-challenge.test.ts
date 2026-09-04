import { describe, expect, it } from "vitest";
import { assertResolverIsNotMetronome, assertValidMetronomeChallengeSubstance, InvalidMetronomeChallengeError, METRONOME_ACTOR_ID } from "./metronome-challenge.js";

describe("Metronome challenge", () => {
  it("accepts a valid substance", () => {
    expect(() => assertValidMetronomeChallengeSubstance({ reason: "unsupported claim", evidenceReferences: ["ev-1"] })).not.toThrow();
  });
  it("rejects an unknown field", () => {
    expect(() => assertValidMetronomeChallengeSubstance({ reason: "x", evidenceReferences: [], extra: 1 })).toThrow(InvalidMetronomeChallengeError);
  });
  it("rejects a blank reason", () => {
    expect(() => assertValidMetronomeChallengeSubstance({ reason: "", evidenceReferences: [] })).toThrow(InvalidMetronomeChallengeError);
  });
  it("rejects the canonical Metronome role resolving its own durable challenge identity", () => {
    expect(() => assertResolverIsNotMetronome("  encore-metronome  ", " encore-metronome ")).toThrow(InvalidMetronomeChallengeError);
  });
  it("rejects the canonical Metronome role even when called through the legacy actor constant", () => {
    expect(METRONOME_ACTOR_ID).toBe("encore-metronome");
    expect(() => assertResolverIsNotMetronome(METRONOME_ACTOR_ID)).toThrow(InvalidMetronomeChallengeError);
  });
  it("allows a non-Metronome actor to resolve", () => {
    expect(() => assertResolverIsNotMetronome("head:product", "encore-metronome")).not.toThrow();
  });
});
