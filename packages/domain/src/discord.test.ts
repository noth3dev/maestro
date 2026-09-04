import { describe, expect, it } from "vitest";
import { DiscordFreshnessError, DiscordSignalError, assertValidDiscordSignal, signDiscordSignal, verifyDiscordSignal, type DiscordSignal } from "./discord.js";
import { deriveDiscordIncidentFingerprint } from "./discord-identity.js";

const signal = (overrides: Partial<DiscordSignal> = {}, preserveFingerprint = false): DiscordSignal => {
  const value: DiscordSignal = {
    incidentFingerprint: "",
    firstObservedAt: "2026-01-01T00:00:01.000Z",
    lastObservedAt: "2026-01-01T00:00:02.000Z",
    severity: "warning",
    confidence: 0.9,
    affectedComponent: "control-plane",
    affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "health-probe",
    sourceFreshness: "2026-01-01T00:00:02.000Z",
    deduplicationRelationship: "new",
    discordHealthState: "healthy",
    ...overrides,
  };
  return preserveFingerprint ? value : { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
};

describe("Discord signal validation", () => {
  it("requires observation timestamps to be ordered", () => {
    expect(() => assertValidDiscordSignal(signal({ lastObservedAt: "2026-01-01T00:00:00.000Z" }))).toThrow(DiscordSignalError);
  });

  it("requires every minimal reproduction evidence item to be text", () => {
    expect(() => assertValidDiscordSignal(signal({ minimalReproductionEvidence: ["safe", 42] as unknown as readonly string[] }))).toThrow(DiscordSignalError);
  });

  it("rejects an invalid issued timestamp before signing", () => {
    expect(() => signDiscordSignal(signal(), "secret", "nonce", 1, "not-a-date")).toThrow(DiscordSignalError);
  });
  it("rejects a non-finite freshness window instead of bypassing freshness checks", () => {
    const envelope = signDiscordSignal(signal(), "secret", "nonce", 1, "2026-01-01T00:00:03.000Z");
    expect(() => verifyDiscordSignal(envelope, "secret", Date.parse(envelope.issuedAt), Number.NaN)).toThrow(DiscordSignalError);
  });

  it("rejects a caller-selected fingerprint even when it has the required shape", () => {
    const arbitrary = signal({ incidentFingerprint: "0".repeat(64) }, true);
    expect(() => signDiscordSignal(arbitrary, "secret", "nonce", 1, "2026-01-01T00:00:02.000Z")).toThrow(DiscordSignalError);
  });

  it("redacts secret-like evidence before signing while preserving bounded safe evidence", () => {
    const secret = "raw-secret-value";
    const envelope = signDiscordSignal(signal({
      minimalReproductionEvidence: [
        `Authorization: Bearer ${secret}`,
        `password=${secret}`,
        "GET /health -> 503",
      ],
    }), "secret", "nonce-redacted", 1, "2026-01-01T00:00:02.000Z");
    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(envelope.signal.minimalReproductionEvidence).toContain("GET /health -> 503");
    expect(envelope.signal.minimalReproductionEvidence.join(" ")).toContain("[REDACTED]");
  });

  it("rejects future and stale observation/source timestamps at verification", () => {
    const future = signal({
      lastObservedAt: "2026-01-01T00:00:06.000Z",
      sourceFreshness: "2026-01-01T00:00:06.000Z",
    });
    expect(() => signDiscordSignal(future, "secret", "future", 2, "2026-01-01T00:00:05.000Z")).toThrow(DiscordFreshnessError);

    const stale = signal({
      firstObservedAt: "2025-12-31T23:00:01.000Z",
      lastObservedAt: "2025-12-31T23:00:02.000Z",
      sourceFreshness: "2025-12-31T23:00:02.000Z",
    });
    const envelope = signDiscordSignal(stale, "secret", "stale", 3, "2026-01-01T00:00:05.000Z");
    expect(() => verifyDiscordSignal(envelope, "secret", Date.parse("2026-01-01T00:00:05.000Z"), 1_000)).toThrow(DiscordFreshnessError);
  });
});
