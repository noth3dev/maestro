import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveDiscordIncidentFingerprint, signDiscordSignal, type DiscordSignal } from "@maestro/domain";
import { listDiscordSignals, recordDiscordSignal } from "./discord.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
// This test builds an isolated schema directly from the relevant migration
// files' SQL content, rather than running the full production migration
// chain (which also touches unrelated tables this focused test never
// creates).
const migrations = ["0042_discord_signals.sql", "0043_discord_signal_hardening.sql", "0044_discord_incidents.sql", "0045_discord_integrity.sql", "0047_discord_incident_workflow.sql", "0048_discord_improvement_evidence.sql"];
const signal = (): DiscordSignal => {
  const value: DiscordSignal = {
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
    discordHealthState: "healthy",
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
};

const envelope = (sequence: number, nonce = randomUUID()) => signDiscordSignal(
  signal(),
  "discord-test-secret",
  nonce,
  sequence,
  "2026-01-01T00:00:05.000Z",
);

describeDatabase("Discord signal receiver with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS discord_watchdog_checks, discord_incident_signals, discord_incidents, discord_signals CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE discord_watchdog_checks, discord_incident_signals, discord_incidents, discord_signals"); });
  afterAll(async () => { await pool.end(); });

  it("stores one authenticated signal and rejects a replay without a second row", async () => {
    const first = await recordDiscordSignal(pool, envelope(1, "nonce-1"), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    expect(first.sequence).toBe(1);
    await expect(recordDiscordSignal(pool, envelope(1, "nonce-1"), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") })).rejects.toThrow();
    expect(await listDiscordSignals(pool)).toHaveLength(1);
  });

  it("keeps accepted signals immutable for audit", async () => {
    const stored = await recordDiscordSignal(pool, envelope(1, "immutable"), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    await expect(pool.query("UPDATE discord_signals SET severity = 'critical' WHERE signal_id = $1", [stored.signalId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM discord_signals WHERE signal_id = $1", [stored.signalId])).rejects.toThrow();
    expect((await listDiscordSignals(pool))[0]?.severity).toBe("warning");
  });

  it("serializes concurrent writers so an older sequence cannot commit after a newer sequence", async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION discord_test_delay_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('discord_test_insert', NEW.sequence::text);
        IF NEW.sequence = 2 THEN PERFORM pg_sleep(0.2); END IF;
        RETURN NEW;
      END $$;
    `);
    await pool.query("DROP TRIGGER IF EXISTS discord_test_delay_insert_trigger ON discord_signals");
    await pool.query("CREATE TRIGGER discord_test_delay_insert_trigger BEFORE INSERT ON discord_signals FOR EACH ROW EXECUTE FUNCTION discord_test_delay_insert()");
    const listener = await pool.connect();
    try {
      await listener.query("LISTEN discord_test_insert");
      const newer = recordDiscordSignal(pool, envelope(2, "nonce-b"), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
      await new Promise<void>((resolve) => listener.once("notification", () => resolve()));
      const older = recordDiscordSignal(pool, envelope(1, "nonce-a"), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
      const results = await Promise.allSettled([newer, older]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect((await listDiscordSignals(pool))[0]?.sequence).toBe(2);
    } finally {
      listener.release();
      await pool.query("DROP TRIGGER IF EXISTS discord_test_delay_insert_trigger ON discord_signals");
      await pool.query("DROP FUNCTION IF EXISTS discord_test_delay_insert()");
    }
  });
});
