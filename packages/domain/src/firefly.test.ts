import { describe, expect, it } from "vitest";
import { FireflySignalError, assertValidFireflySignal, signFireflySignal, verifyFireflySignal, type FireflySignal } from "./firefly.js";

const signal = (overrides: Partial<FireflySignal> = {}): FireflySignal => ({
  incidentFingerprint: "fp-1",
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
  fireflyHealthState: "healthy",
  ...overrides,
});

describe("Firefly signal validation", () => {
  it("requires observation timestamps to be ordered", () => {
    expect(() => assertValidFireflySignal(signal({ lastObservedAt: "2026-01-01T00:00:00.000Z" }))).toThrow(FireflySignalError);
  });

  it("requires every minimal reproduction evidence item to be text", () => {
    expect(() => assertValidFireflySignal(signal({ minimalReproductionEvidence: ["safe", 42] as unknown as readonly string[] }))).toThrow(FireflySignalError);
  });

  it("rejects an invalid issued timestamp before signing", () => {
    expect(() => signFireflySignal(signal(), "secret", "nonce", 1, "not-a-date")).toThrow(FireflySignalError);
  });
  it("rejects a non-finite freshness window instead of bypassing freshness checks", () => {
    const envelope = signFireflySignal(signal(), "secret", "nonce", 1, "2026-01-01T00:00:01.000Z");
    expect(() => verifyFireflySignal(envelope, "secret", Date.parse(envelope.issuedAt), Number.NaN)).toThrow(FireflySignalError);
  });
});
