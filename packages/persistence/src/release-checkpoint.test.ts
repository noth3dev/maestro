import { describe, expect, it } from "vitest";
import {
  ReleaseCheckpointValidationError,
  computeReleaseCandidateIdentity,
  validateReleaseCandidateIdentity,
} from "./release-checkpoint.js";

const baseIdentity = () => ({
  schemaVersions: {
    contract: "task-contract@1",
    event: "events@1",
    database: "a".repeat(64),
    authorityPolicy: "authority-policy@7",
    evidence: "evidence@3",
  },
  pins: {
    node: "v24.19.0",
    postgres: "17.6",
    modelGateway: "gateway@a096c35",
    providerAdapters: "adapters@a096c35",
    browser: "chromium@140.0.7339.16",
    packages: "b".repeat(64),
  },
  configuration: { databaseEngine: "embedded", routingMode: "ensemble" },
  databaseStateHash: "c".repeat(64),
  improvementClasses: {
    enabled: [],
    disabled: ["persona_axis", "routing_capability_axis"],
    certified: [],
  },
});

describe("release candidate identity", () => {
  it("records the exact contract, schema, authority, evidence, runtime, provider, browser, package, and state pins", () => {
    const identity = validateReleaseCandidateIdentity(baseIdentity());
    const candidateId = computeReleaseCandidateIdentity(identity);

    expect(candidateId).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).toMatchObject({
      schemaVersions: baseIdentity().schemaVersions,
      pins: baseIdentity().pins,
      databaseStateHash: "c".repeat(64),
    });
  });

  it("is deterministic for the same state and changes identity when a tracked component changes", () => {
    const identity = baseIdentity();
    expect(computeReleaseCandidateIdentity(identity)).toBe(computeReleaseCandidateIdentity({ ...identity, configuration: { routingMode: "ensemble", databaseEngine: "embedded" } }));
    expect(computeReleaseCandidateIdentity(identity)).not.toBe(computeReleaseCandidateIdentity({ ...identity, pins: { ...identity.pins, browser: "chromium@141" } }));
    expect(computeReleaseCandidateIdentity(identity)).not.toBe(computeReleaseCandidateIdentity({ ...identity, databaseStateHash: "d".repeat(64) }));
  });

  it("rejects an enabled improvement class that is not explicitly certified and requires every class to be classified", () => {
    expect(() => validateReleaseCandidateIdentity({ ...baseIdentity(), improvementClasses: { enabled: ["persona_axis"], disabled: ["routing_capability_axis"], certified: [] } })).toThrow(ReleaseCheckpointValidationError);
    expect(() => validateReleaseCandidateIdentity({ ...baseIdentity(), improvementClasses: { enabled: [], disabled: ["persona_axis"], certified: [] } })).toThrow("every improvement class");
  });

  it("rejects missing exact pins instead of silently recording an unknown dependency", () => {
    expect(() => validateReleaseCandidateIdentity({ ...baseIdentity(), pins: { ...baseIdentity().pins, modelGateway: "" } })).toThrow("modelGateway");
    expect(() => validateReleaseCandidateIdentity({ ...baseIdentity(), schemaVersions: { ...baseIdentity().schemaVersions, database: "not-a-hash" } })).toThrow("database");
  });

  it("fails closed on duplicate classes and colliding configuration keys", () => {
    expect(() => validateReleaseCandidateIdentity({
      ...baseIdentity(),
      improvementClasses: { enabled: [], disabled: ["persona_axis", "persona_axis", "routing_capability_axis"], certified: [] },
    })).toThrow("duplicate");
    expect(() => validateReleaseCandidateIdentity({
      ...baseIdentity(),
      configuration: { " routingMode ": "ensemble", routingMode: "pin" },
    })).toThrow("colliding");
    expect(() => validateReleaseCandidateIdentity({
      ...baseIdentity(),
      configuration: JSON.parse('{"__proto__":"forbidden"}'),
    })).toThrow("reserved");
  });
});
