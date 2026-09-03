import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveFireflyIncidentFingerprint, signFireflySignal, type FireflySignal } from "@maestro/domain";
import { listFireflySignals, recordFireflySignal } from "./firefly.js";
import { attachFireflySignalToIncident, listFireflyIncidents, listFireflySilenceChecks, recordFireflySilenceCheck } from "./firefly-incident.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0042_firefly_signals.sql", "0043_firefly_signal_hardening.sql", "0044_firefly_incidents.sql", "0045_firefly_integrity.sql"];

const signal = (overrides: Partial<FireflySignal> = {}): FireflySignal => {
  const value: FireflySignal = {
    incidentFingerprint: "",
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
  };
  return { ...value, incidentFingerprint: deriveFireflyIncidentFingerprint(value) };
};

const envelope = (sequence: number, overrides: Partial<FireflySignal> = {}, issuedAt = "2026-01-01T00:00:05.000Z") => signFireflySignal(
  signal(overrides),
  "firefly-test-secret",
  randomUUID(),
  sequence,
  issuedAt,
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

  it("derives silence from the latest durable signal instead of caller observation text", async () => {
    await recordFireflySignal(pool, envelope(1, { lastObservedAt: "2026-01-01T00:00:08.000Z", sourceFreshness: "2026-01-01T00:00:08.000Z" }, "2026-01-01T00:00:09.000Z"), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z"), freshnessWindowMs: 10_000 });
    const check = await recordFireflySilenceCheck(pool, "1970-01-01T00:00:00.000Z", "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 });
    expect(check.state).toBe("observing");
    expect(check.lastObservedAt).toBe("2026-01-01T00:00:08.000Z");
    expect(check.silenceMs).toBe(3_000);
  });

  it("rolls back an accepted signal when atomic incident attachment fails", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION firefly_test_fail_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'incident attachment failure'; END $$`);
    await pool.query("CREATE TRIGGER firefly_test_fail_incident_trigger AFTER INSERT ON firefly_incidents FOR EACH ROW EXECUTE FUNCTION firefly_test_fail_incident()");
    const candidate = envelope(1, {}, "2026-01-01T00:00:05.000Z");
    try {
      await expect(recordFireflySignal(pool, candidate, "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") })).rejects.toThrow();
      expect((await pool.query("SELECT 1 FROM firefly_signals WHERE nonce = $1", [candidate.nonce])).rows).toHaveLength(0);
      expect((await listFireflySignals(pool))).toHaveLength(0);
      expect(await listFireflyIncidents(pool)).toHaveLength(0);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS firefly_test_fail_incident_trigger ON firefly_incidents");
      await pool.query("DROP FUNCTION IF EXISTS firefly_test_fail_incident()");
    }
  });

  it("rejects a direct SQL link when incident and signal identities differ", async () => {
    const first = await recordFireflySignal(pool, envelope(1), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const second = await recordFireflySignal(pool, envelope(2, { affectedVersion: "2.0.0" }), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const incidents = await listFireflyIncidents(pool);
    const firstIncident = incidents.find((incident) => incident.affectedVersion === first.affectedVersion)!;
    expect(firstIncident).toBeDefined();
    await expect(pool.query("INSERT INTO firefly_incident_signals (incident_id, signal_id) VALUES ($1, $2)", [firstIncident.incidentId, second.signalId])).rejects.toThrow();
  });

  it("redacts secret-like evidence before persistence and retrieval", async () => {
    const secret = "persist-secret-value";
    const stored = await recordFireflySignal(pool, envelope(1, {
      minimalReproductionEvidence: [`Authorization: Bearer ${secret}`, `api_key: ${secret}`, `password=${secret}`, "safe evidence"],
    }), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await listFireflySignals(pool))).not.toContain(secret);
    const raw = await pool.query<{ minimal_reproduction_evidence: string[] }>("SELECT minimal_reproduction_evidence FROM firefly_signals WHERE signal_id = $1", [stored.signalId]);
    expect(JSON.stringify(raw.rows[0]?.minimal_reproduction_evidence)).not.toContain(secret);
    expect(JSON.stringify(raw.rows[0]?.minimal_reproduction_evidence)).toContain("[REDACTED]");
  });
});
