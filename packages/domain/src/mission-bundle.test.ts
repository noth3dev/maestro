import { describe, expect, it } from "vitest";
import {
  assertValidMissionBundleSubstance,
  deriveMissionPersonaOverlay,
  InvalidMissionBundleError,
  isMissionPersonaOverlayExpired,
  missionBundleSubstanceContentHash,
  type MissionBundleSubstance,
  type MissionPersonaOverlayInputs,
} from "./mission-bundle.js";
import { PERSONA_AXES, SANE_PERSONA_BASELINE, type PersonaProfile } from "./persona.js";

const substance = (overrides: Partial<MissionBundleSubstance> = {}): MissionBundleSubstance => ({
  role: "scout", profileRef: "profile-1", goalBrief: "assess risk before implementation",
  approvedModels: ["model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/x"],
  environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "5 USD", timeCeiling: "2 hours", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"],
  terminationConditions: ["deadline passed"],
  ...overrides,
});

describe("Mission Bundle", () => {
  it("accepts a valid scout substance and hashes canonically", () => {
    const value = substance();
    expect(() => assertValidMissionBundleSubstance(value)).not.toThrow();
    expect(missionBundleSubstanceContentHash(value)).toBe(missionBundleSubstanceContentHash({ ...value }));
  });

  it("rejects an unknown field", () => {
    expect(() => assertValidMissionBundleSubstance({ ...substance(), extra: 1 })).toThrow(InvalidMissionBundleError);
  });

  it("rejects an invalid role", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ role: "manager" as never }))).toThrow(InvalidMissionBundleError);
  });

  it("rejects an empty approvedModels list", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ approvedModels: [] }))).toThrow(InvalidMissionBundleError);
  });

  it("rejects a nonzero workerCeiling for a scout or execution bundle", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ workerCeiling: 1 }))).toThrow(InvalidMissionBundleError);
    expect(() => assertValidMissionBundleSubstance(substance({ role: "execution", workerCeiling: 2 }))).toThrow(InvalidMissionBundleError);
  });

  it("allows a nonzero workerCeiling for a head bundle", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ role: "head", workerCeiling: 3 }))).not.toThrow();
  });

  it("rejects empty validationCriteria or terminationConditions", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ validationCriteria: [] }))).toThrow(InvalidMissionBundleError);
    expect(() => assertValidMissionBundleSubstance(substance({ terminationConditions: [] }))).toThrow(InvalidMissionBundleError);
  });

  it("rejects a negative retryCeiling", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ retryCeiling: -1 }))).toThrow(InvalidMissionBundleError);
  });
});

describe("Mission persona overlay derivation", () => {
  const departmentStyle: PersonaProfile = {
    agreeableness: 0.6, extraversion: 0.6, imagination: 0.5, realism: 0.6, conscientiousness: 0.7,
    caution: 0.6, initiative: 0.5, empathy: 0.6, adaptability: 0.6, sociability: 0.6,
  };
  const headChoice: PersonaProfile = SANE_PERSONA_BASELINE;

  function overlayInputs(overrides: Partial<MissionPersonaOverlayInputs> = {}): MissionPersonaOverlayInputs {
    return {
      departmentStyle, headChoice,
      taskAmbiguity: 0.5, risk: 0.5, collaborationDemand: 0.5, evidenceBurden: 0.5,
      ...overrides,
    };
  }

  it("derives a full ten-axis profile with every axis inside [0,1]", () => {
    const persona = deriveMissionPersonaOverlay(overlayInputs());
    for (const axis of PERSONA_AXES) {
      expect(persona[axis]).toBeGreaterThanOrEqual(0);
      expect(persona[axis]).toBeLessThanOrEqual(1);
    }
  });

  it("stays inside [0,1] even at the extremes of every input factor", () => {
    const extremes = [0, 1];
    for (const taskAmbiguity of extremes) {
      for (const risk of extremes) {
        for (const collaborationDemand of extremes) {
          for (const evidenceBurden of extremes) {
            const persona = deriveMissionPersonaOverlay(overlayInputs({ taskAmbiguity, risk, collaborationDemand, evidenceBurden }));
            for (const axis of PERSONA_AXES) {
              expect(persona[axis]).toBeGreaterThanOrEqual(0);
              expect(persona[axis]).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it("bounds every axis for edge-valued source profiles", () => {
    const edgeProfiles: PersonaProfile[] = [0, 1].map((value) =>
      Object.fromEntries(PERSONA_AXES.map((axis) => [axis, value])) as PersonaProfile,
    );
    for (const departmentStyle of edgeProfiles) {
      for (const headChoice of edgeProfiles) {
        for (const taskAmbiguity of [0, 1]) {
          for (const risk of [0, 1]) {
            for (const collaborationDemand of [0, 1]) {
              for (const evidenceBurden of [0, 1]) {
                const persona = deriveMissionPersonaOverlay({
                  departmentStyle, headChoice, taskAmbiguity, risk, collaborationDemand, evidenceBurden,
                });
                for (const axis of PERSONA_AXES) {
                  expect(persona[axis]).toBeGreaterThanOrEqual(0);
                  expect(persona[axis]).toBeLessThanOrEqual(1);
                }
              }
            }
          }
        }
      }
    }
  });

  it("rejects an out-of-range scalar factor", () => {
    expect(() => deriveMissionPersonaOverlay(overlayInputs({ risk: 1.5 }))).toThrow(InvalidMissionBundleError);
    expect(() => deriveMissionPersonaOverlay(overlayInputs({ taskAmbiguity: -0.1 }))).toThrow(InvalidMissionBundleError);
  });

  it("rejects an invalid persona profile input", () => {
    expect(() => deriveMissionPersonaOverlay(overlayInputs({ headChoice: { ...headChoice, caution: 2 } }))).toThrow(InvalidMissionBundleError);
  });
});

describe("Mission persona overlay expiry", () => {
  const identity = { councilId: "c1", departmentId: "product", planVersion: 1, itemId: "scout-1" };

  it("is not expired before its explicit expiresAt", () => {
    const overlay = { ...identity, persona: SANE_PERSONA_BASELINE, issuedAt: new Date(0).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    expect(isMissionPersonaOverlayExpired(overlay, new Date())).toBe(false);
  });

  it("is expired once now passes its explicit expiresAt -- the mission has ended", () => {
    const overlay = { ...identity, persona: SANE_PERSONA_BASELINE, issuedAt: new Date(0).toISOString(), expiresAt: new Date(Date.now() - 1).toISOString() };
    expect(isMissionPersonaOverlayExpired(overlay, new Date())).toBe(true);
  });

  it("is unavailable exactly at its explicit expiresAt boundary", () => {
    const expiresAt = new Date("2026-01-01T00:00:00.000Z");
    const overlay = { ...identity, persona: SANE_PERSONA_BASELINE, issuedAt: new Date(0).toISOString(), expiresAt: expiresAt.toISOString() };
    expect(isMissionPersonaOverlayExpired(overlay, expiresAt)).toBe(true);
  });

  it("fails closed when the expiry or observation time is invalid", () => {
    const validNow = new Date("2026-01-01T00:00:00.000Z");
    expect(isMissionPersonaOverlayExpired({ expiresAt: "not-a-timestamp" }, validNow)).toBe(true);
    expect(isMissionPersonaOverlayExpired({ expiresAt: "2027-01-01T00:00:00.000Z" }, new Date("invalid"))).toBe(true);
  });
});
