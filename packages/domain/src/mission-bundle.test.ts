import { describe, expect, it } from "vitest";
import { assertValidMissionBundleSubstance, InvalidMissionBundleError, missionBundleSubstanceContentHash, type MissionBundleSubstance } from "./mission-bundle.js";

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
