import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signFireflySignal, type FireflySignal } from "@maestro/domain";
import { listFireflySignals, recordFireflySignal } from "./firefly.js";
import { attachFireflySignalToIncident, listFireflyIncidents, listFireflySilenceChecks, recordFireflySilenceCheck } from "./firefly-incident.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0039_firefly_signals.sql", "0040_firefly_signal_hardening.sql", "0041_firefly_incidents.sql"];

const signal = (overrides: Partial<FireflySignal> = {}): FireflySignal => ({
  incidentFingerprint: "fp-1",
  firstObservedAt: "2026-01-01T00:00:01.000Z",
  lastObservedAt: "2026-01-01T00:00:02.000Z",
  severity: "warning",
  confidence: 0.4,
  affectedComponent: "control-plane",
  affectedVersion: "1.0.0",
  minimalReproductionEvidence: ["GET /health -> 503"],
  source: "health-probe",
  sourceFreshness: "2026-01-01T00:00:02.000Z",
  deduplicationRelationship: "new",
  fireflyHealthState: "healthy",
  ...overrides,
});

const envelope = (sequence: number, overrides: Partial<FireflySignal> = {}) => signFireflySignal(
  signal(overrides),
  "firefly-test-secret",
  randomUUID(),
  sequence,
  "2026-01-01T00:00:05.000Z",
);

describeDatabase("Firefly incident records with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS firefly_watchdog_checks, firefly_incident_signals, firefly_incidents, firefly_signals CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE firefly_watchdog_checks, firefly_incident_signals, firefly_incidents, firefly_signals"); });
  afterAll(async () => { await pool.end(); });

  it("deduplicates by fingerprint and affected version while retaining signal history and strongest score", async () => {
    const first = await recordFireflySignal(pool, envelope(1), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const second = await recordFireflySignal(pool, envelope(2, { severity: "critical", confidence: 0.8, deduplicationRelationship: "same", lastObservedAt: "2026-01-01T00:00:03.000Z" }), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const otherVersion = await recordFireflySignal(pool, envelope(3, { affectedVersion: "2.0.0" }), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const incident = await attachFireflySignalToIncident(pool, first.signalId);
    const updated = await attachFireflySignalToIncident(pool, second.signalId);
    const separate = await attachFireflySignalToIncident(pool, otherVersion.signalId);
    expect(updated.incidentId).toBe(incident.incidentId);
    expect(updated.signalCount).toBe(2);
    expect(updated.severity).toBe("critical");
    expect(updated.confidence).toBe(0.8);
    expect(updated.firstObservedAt).toBe(incident.firstObservedAt);
    expect(updated.lastObservedAt).toBe("2026-01-01T00:00:03.000Z");
    expect(separate.incidentId).not.toBe(incident.incidentId);
    expect(await listFireflyIncidents(pool)).toHaveLength(2);
    expect(await listFireflySignals(pool)).toHaveLength(3);
    const retried = await attachFireflySignalToIncident(pool, second.signalId);
    expect(retried).toEqual(updated);
  });

  it("records watchdog silence as uncertainty without creating a no-incident conclusion", async () => {
    const missing = await recordFireflySilenceCheck(pool, null, "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 });
    expect(missing.state).toBe("uncertain");
    expect(missing.reason).toBe("firefly_observation_missing");
    const silent = await recordFireflySilenceCheck(pool, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 });
    expect(silent.state).toBe("uncertain");
    expect(silent.reason).toBe("firefly_observation_silent");
    expect(await listFireflyIncidents(pool)).toHaveLength(0);
    expect(await listFireflySilenceChecks(pool)).toHaveLength(2);
  });
});
