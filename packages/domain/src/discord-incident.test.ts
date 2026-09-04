import { describe, expect, it } from "vitest";
import { DiscordSignalError, type DiscordSignal } from "./discord.js";
import { assessDiscordSilence, buildDiscordIncidentBrief, computeDiscordImprovementEvidence, deriveDiscordIncidentFingerprint, requiresImmediateSafePause, routeDiscordIncidentDepartments, scoreDiscordSignals } from "./discord-incident.js";

const signal = (overrides: Partial<DiscordSignal> = {}): DiscordSignal => {
  const value: DiscordSignal = {
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
    discordHealthState: "healthy",
    ...overrides,
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
};

describe("Discord incident fingerprinting and scoring", () => {
  it("derives the same fingerprint for equivalent normalized evidence", () => {
    const first = deriveDiscordIncidentFingerprint(signal());
    const second = deriveDiscordIncidentFingerprint(signal({
      affectedComponent: " control-plane ",
      source: " health-probe ",
      minimalReproductionEvidence: ["  get /health   -> 503  "],
    }));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("aggregates severity conservatively and confidence by the strongest corroborated signal", () => {
    expect(scoreDiscordSignals([
      { severity: "info", confidence: 0.4 },
      { severity: "critical", confidence: 0.8 },
      { severity: "warning", confidence: 0.7 },
    ])).toEqual({ severity: "critical", confidence: 0.8 });
  });

  it("rejects an empty score input instead of fabricating an incident assessment", () => {
    expect(() => scoreDiscordSignals([])).toThrow(DiscordSignalError);
  });
});

describe("Discord silence monitoring", () => {
  it("reports observing while the latest observation is within the allowed silence window", () => {
    expect(assessDiscordSilence("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:05.000Z", { maxSilenceMs: 10_000 })).toEqual({
      state: "observing", silenceMs: 5_000, reason: null,
    });
  });

  it("reports watchdog-health uncertainty after the window without inferring that incidents are absent", () => {
    expect(assessDiscordSilence("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 })).toEqual({
      state: "uncertain", silenceMs: 11_000, reason: "discord_observation_silent",
    });
  });

  it("reports uncertainty when there has never been an observation", () => {
    expect(assessDiscordSilence(null, "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 })).toEqual({
      state: "uncertain", silenceMs: null, reason: "discord_observation_missing",
    });
  });
});


describe("Discord Incident Brief and routing", () => {
  const summary = {
    incidentFingerprint: "f".repeat(64),
    affectedComponent: "control-plane",
    affectedVersion: "1.0.0",
    severity: "critical" as const,
    confidence: 0.9,
    firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-01-01T00:00:05.000Z",
    signalCount: 3,
  };

  it("routes a crash to Operations and Engineering", () => {
    expect(routeDiscordIncidentDepartments("crash")).toEqual(["operations", "engineering"]);
  });

  it("routes a vulnerability to Security and Engineering", () => {
    expect(routeDiscordIncidentDepartments("vulnerability")).toEqual(["security", "engineering"]);
  });

  it("builds a bounded brief that caps evidence and never expands beyond the deterministic routing", () => {
    const evidence = Array.from({ length: 20 }, (_, i) => `evidence-${i}`);
    const brief = buildDiscordIncidentBrief(summary, evidence, "crash");
    expect(brief.boundedEvidence).toHaveLength(5);
    expect(brief.boundedEvidence).toEqual(evidence.slice(0, 5));
    expect(brief.routedDepartments).toEqual(["operations", "engineering"]);
    expect(brief.incidentFingerprint).toBe(summary.incidentFingerprint);
  });

  it("rejects an invalid severity or confidence rather than fabricating a brief", () => {
    expect(() => buildDiscordIncidentBrief({ ...summary, severity: "bogus" as never }, [], "crash")).toThrow(DiscordSignalError);
    expect(() => buildDiscordIncidentBrief({ ...summary, confidence: 1.5 }, [], "crash")).toThrow(DiscordSignalError);
  });

  it("requires immediate safe pause only for high-confidence critical severity", () => {
    expect(requiresImmediateSafePause("critical", 0.9)).toBe(true);
    expect(requiresImmediateSafePause("critical", 0.5)).toBe(false);
    expect(requiresImmediateSafePause("warning", 0.99)).toBe(false);
  });
});


describe("Discord improvement evidence", () => {
  it("computes bounded detection-to-triage and triage-to-close durations", () => {
    const evidence = computeDiscordImprovementEvidence(
      "resolved", "critical", 0.9,
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z", "2026-01-01T00:01:10.000Z",
    );
    expect(evidence.detectionToTriageMs).toBe(10_000);
    expect(evidence.triageToCloseMs).toBe(60_000);
    expect(evidence.outcome).toBe("resolved");
  });

  it("reports null durations for a false positive closed without ever linking a Goal", () => {
    const evidence = computeDiscordImprovementEvidence(
      "false_positive", "warning", 0.3,
      "2026-01-01T00:00:00.000Z", null, "2026-01-01T00:00:05.000Z",
    );
    expect(evidence.detectionToTriageMs).toBeNull();
    expect(evidence.triageToCloseMs).toBeNull();
  });

  it("rejects out-of-order or invalid timestamps rather than fabricating a duration", () => {
    expect(() => computeDiscordImprovementEvidence("resolved", "critical", 0.9, "2026-01-01T00:00:10.000Z", "2026-01-01T00:00:05.000Z", "2026-01-01T00:01:00.000Z")).toThrow();
    expect(() => computeDiscordImprovementEvidence("resolved", "critical", 0.9, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:05.000Z", "2026-01-01T00:00:01.000Z")).toThrow();
    expect(() => computeDiscordImprovementEvidence("resolved", "bogus" as never, 0.9, "2026-01-01T00:00:00.000Z", null, "2026-01-01T00:00:01.000Z")).toThrow();
  });
});
