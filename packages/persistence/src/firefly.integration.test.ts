import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveFireflyIncidentFingerprint, signFireflySignal, type FireflySignal } from "@maestro/domain";
import { listFireflySignals, recordFireflySignal } from "./firefly.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0039_firefly_signals.sql", "0040_firefly_signal_hardening.sql", "0041_firefly_incidents.sql", "0042_firefly_integrity.sql"];

const signal = (): FireflySignal => {
  const value: FireflySignal = {
    incidentFingerprint: "",
    firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-01-01T00:00:01.000Z",
    severity: "warning",
    confidence: 0.9,
    affectedComponent: "control-plane",
    affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "health-probe",
    sourceFreshness: "2026-01-01T00:00:01.000Z",
    deduplicationRelationship: "new",
    fireflyHealthState: "healthy",
  };
  return { ...value, incidentFingerprint: deriveFireflyIncidentFingerprint(value) };
};

const envelope = (sequence: number, nonce = randomUUID()) => signFireflySignal(
  signal(),
  "firefly-test-secret",
  nonce,
  sequence,
  "2026-01-01T00:00:05.000Z",
);

describeDatabase("Firefly signal receiver with PostgreSQL", () => {
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

  it("stores one authenticated signal and rejects a replay without a second row", async () => {
    const first = await recordFireflySignal(pool, envelope(1, "nonce-1"), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    expect(first.sequence).toBe(1);
    await expect(recordFireflySignal(pool, envelope(1, "nonce-1"), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") })).rejects.toThrow();
    expect(await listFireflySignals(pool)).toHaveLength(1);
  });

  it("keeps accepted signals immutable for audit", async () => {
    const stored = await recordFireflySignal(pool, envelope(1, "immutable"), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    await expect(pool.query("UPDATE firefly_signals SET severity = 'critical' WHERE signal_id = $1", [stored.signalId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM firefly_signals WHERE signal_id = $1", [stored.signalId])).rejects.toThrow();
    expect((await listFireflySignals(pool))[0]?.severity).toBe("warning");
  });

  it("serializes concurrent writers so an older sequence cannot commit after a newer sequence", async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION firefly_test_delay_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('firefly_test_insert', NEW.sequence::text);
        IF NEW.sequence = 2 THEN PERFORM pg_sleep(0.2); END IF;
        RETURN NEW;
      END $$;
    `);
    await pool.query("DROP TRIGGER IF EXISTS firefly_test_delay_insert_trigger ON firefly_signals");
    await pool.query("CREATE TRIGGER firefly_test_delay_insert_trigger BEFORE INSERT ON firefly_signals FOR EACH ROW EXECUTE FUNCTION firefly_test_delay_insert()");
    const listener = await pool.connect();
    try {
      await listener.query("LISTEN firefly_test_insert");
      const newer = recordFireflySignal(pool, envelope(2, "nonce-b"), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
      await new Promise<void>((resolve) => listener.once("notification", () => resolve()));
      const older = recordFireflySignal(pool, envelope(1, "nonce-a"), "firefly-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
      const results = await Promise.allSettled([newer, older]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect((await listFireflySignals(pool))[0]?.sequence).toBe(2);
    } finally {
      listener.release();
      await pool.query("DROP TRIGGER IF EXISTS firefly_test_delay_insert_trigger ON firefly_signals");
      await pool.query("DROP FUNCTION IF EXISTS firefly_test_delay_insert()");
    }
  });
});
