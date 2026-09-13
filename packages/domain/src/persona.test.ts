import { describe, expect, it } from "vitest";
import { CONCERTMASTER_PERSONA_BASELINE, PERSONA_AXES, composePersonaProfile, extractPersonaCoreIdentity, parseLearnedPersonaProfileVersion, parsePersonaProfile, parseTaskClassPersonaAdjustment } from "./persona.js";

describe("persona profiles", () => {
  it("accepts Concertmaster's fixed, exactly ten-axis baseline", () => {
    expect(PERSONA_AXES).toHaveLength(10);
    expect(parsePersonaProfile(CONCERTMASTER_PERSONA_BASELINE)).toEqual(CONCERTMASTER_PERSONA_BASELINE);
  });

  it("rejects a missing or extra axis", () => {
    const { sociability: _sociability, ...missing } = CONCERTMASTER_PERSONA_BASELINE;
    expect(() => parsePersonaProfile(missing)).toThrow();
    expect(() => parsePersonaProfile({ ...CONCERTMASTER_PERSONA_BASELINE, curiosity: 0.5 })).toThrow();
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects non-normalized axis %s", (value) => {
    expect(() => parsePersonaProfile({ ...CONCERTMASTER_PERSONA_BASELINE, caution: value })).toThrow();
  });
});


describe("learned persona profile layers", () => {
  const rationale = (reason = "reviewed role evidence") => ({
    reason,
    low: "explores less",
    current: "balances the duty",
    high: "explores more",
  });

  it("requires a complete versioned profile with value-level behavioral rationale", () => {
    const version = parseLearnedPersonaProfileVersion({
      roleId: "concertmaster",
      version: 1,
      profile: CONCERTMASTER_PERSONA_BASELINE,
      rationale: Object.fromEntries(PERSONA_AXES.map((axis) => [axis, rationale()])),
      source: "phase-2-approved-seed",
    });
    expect(version.profile).toEqual(CONCERTMASTER_PERSONA_BASELINE);
    expect(version.rationale.caution.low).toBe("explores less");
  });

  it("preserves the exact approved Concertmaster seed", () => {
    const expected = JSON.stringify({
      agreeableness: 0.70, extraversion: 0.75, imagination: 0.65, realism: 0.90,
      conscientiousness: 0.95, caution: 0.90, initiative: 0.92, empathy: 0.85,
      adaptability: 0.88, sociability: 0.82,
    });
    expect(JSON.stringify(CONCERTMASTER_PERSONA_BASELINE)).toBe(expected);
  });

  it("composes learned values, task-class deltas, and mission overlay without mutating either source", () => {
    const learned = parseLearnedPersonaProfileVersion({
      roleId: "concertmaster", version: 3, profile: CONCERTMASTER_PERSONA_BASELINE,
      rationale: Object.fromEntries(PERSONA_AXES.map((axis) => [axis, rationale()])), source: "test",
    });
    const adjustment = parseTaskClassPersonaAdjustment({
      roleId: "concertmaster", taskClass: "incident-triage", version: 2,
      delta: { caution: 0.05, initiative: -0.03 }, reason: "incident evidence",
    });
    const missionOverlay = { caution: 0.02, empathy: 0.01 };
    const composed = composePersonaProfile(learned, adjustment, missionOverlay);
    expect(composed.persona.caution).toBeCloseTo(0.97);
    expect(composed.persona.initiative).toBeCloseTo(0.89);
    expect(composed.layers.learnedProfile).toEqual(learned);
    expect(composed.layers.taskClassAdjustment).toEqual(adjustment);
    expect(composed.layers.missionOverlay).toEqual(missionOverlay);
    expect(learned.profile.caution).toBe(0.90);
    expect(adjustment.delta).toEqual({ caution: 0.05, initiative: -0.03 });
  });

  it("rejects a task adjustment that changes more than two axes or leaves the normalized range", () => {
    expect(() => parseTaskClassPersonaAdjustment({
      roleId: "concertmaster", taskClass: "incident-triage", version: 1,
      delta: { caution: 0.01, initiative: 0.01, realism: 0.01 }, reason: "too broad",
    })).toThrow();
    expect(() => parseTaskClassPersonaAdjustment({
      roleId: "concertmaster", taskClass: "incident-triage", version: 1,
      delta: { caution: 2 }, reason: "out of range",
    })).toThrow();
  });

  it("keeps core identity separate from adaptive axis values", () => {
    const core = extractPersonaCoreIdentity({
      roleId: "concertmaster", charter: "coordinate", capabilityBoundary: { allowed: ["coordinate"], forbidden: ["execute"] },
    });
    expect(core).toEqual({
      mission: "coordinate", authority: ["coordinate"], truthfulness: "report evidence accurately",
      safety: "preserve safety and escalation boundaries", prohibitedBehavior: ["execute"],
    });
    expect(Object.keys(core)).toEqual(["mission", "authority", "truthfulness", "safety", "prohibitedBehavior"]);
  });
});
