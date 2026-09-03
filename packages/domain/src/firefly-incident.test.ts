import { describe, expect, it } from "vitest";
import { FireflySignalError, type FireflySignal } from "./firefly.js";
import { assessFireflySilence, deriveFireflyIncidentFingerprint, scoreFireflySignals } from "./firefly-incident.js";

const signal = (overrides: Partial<FireflySignal> = {}): FireflySignal => {
  const value: FireflySignal = {
    incidentFingerprint: "",
    firstObservedAt: "2026-01-01T00:00:01.000Z",
    lastObservedAt: "2026-01-01T00:00:02.000Z",
    severity: "warning",
    confidence: 0.9,
    affectedComponent: "Control-Plane",
    affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "Health-Probe",
    sourceFreshness: "2026-01-01T00:00:02.000Z",
    deduplicationRelationship: "new",
    fireflyHealthState: "healthy",
    ...overrides,
  };
  return { ...value, incidentFingerprint: deriveFireflyIncidentFingerprint(value) };
};

describe("Firefly incident fingerprinting and scoring", () => {
  it("derives the same fingerprint for equivalent normalized evidence", () => {
    const first = deriveFireflyIncidentFingerprint(signal());
    const second = deriveFireflyIncidentFingerprint(signal({
      affectedComponent: " control-plane ",
      source: " health-probe ",
      minimalReproductionEvidence: ["  get /health   -> 503  "],
    }));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("aggregates severity conservatively and confidence by the strongest corroborated signal", () => {
    expect(scoreFireflySignals([
      { severity: "info", confidence: 0.4 },
      { severity: "critical", confidence: 0.8 },
      { severity: "warning", confidence: 0.7 },
    ])).toEqual({ severity: "critical", confidence: 0.8 });
  });

  it("rejects an empty score input instead of fabricating an incident assessment", () => {
    expect(() => scoreFireflySignals([])).toThrow(FireflySignalError);
  });
});

describe("Firefly silence monitoring", () => {
  it("reports observing while the latest observation is within the allowed silence window", () => {
    expect(assessFireflySilence("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:05.000Z", { maxSilenceMs: 10_000 })).toEqual({
      state: "observing", silenceMs: 5_000, reason: null,
    });
  });

  it("reports watchdog-health uncertainty after the window without inferring that incidents are absent", () => {
    expect(assessFireflySilence("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 })).toEqual({
      state: "uncertain", silenceMs: 11_000, reason: "firefly_observation_silent",
    });
  });

  it("reports uncertainty when there has never been an observation", () => {
    expect(assessFireflySilence(null, "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 })).toEqual({
      state: "uncertain", silenceMs: null, reason: "firefly_observation_missing",
    });
  });
});
