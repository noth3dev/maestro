import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveDiscordIncidentFingerprint, signDiscordSignal, type DiscordSignal } from "@maestro/domain";
import { listDiscordSignals, recordDiscordSignal } from "./discord.js";
import { attachDiscordSignalToIncident, listDiscordIncidents, listDiscordSilenceChecks, recordDiscordSilenceCheck } from "./discord-incident.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
// These reference the real on-disk migration filenames, which still say
// "firefly" (existing, already-applied migrations are never renamed -- see
// 0052_rename_sane_firefly_sentinel.sql's header comment for why). This
// test builds an isolated schema directly from those files' SQL content
// with an in-memory firefly->discord substitution, rather than running the
// full production migration/rename chain (which also touches unrelated
// tables this focused test never creates).
const migrations = ["0042_firefly_signals.sql", "0043_firefly_signal_hardening.sql", "0044_firefly_incidents.sql", "0045_firefly_integrity.sql", "0047_firefly_incident_workflow.sql", "0048_firefly_improvement_evidence.sql"];
const renameFireflyToDiscord = (sql: string): string =>
  sql
    .replace(/FIREFLY/g, "DISCORD")
    .replace(/Firefly/g, "Discord")
    .replace(/firefly/g, "discord");

const signal = (overrides: Partial<DiscordSignal> = {}): DiscordSignal => {
  const value: DiscordSignal = {
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
    discordHealthState: "healthy",
    ...overrides,
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
};

const envelope = (sequence: number, overrides: Partial<DiscordSignal> = {}, issuedAt = "2026-01-01T00:00:05.000Z") => signDiscordSignal(
  signal(overrides),
  "discord-test-secret",
  randomUUID(),
  sequence,
  issuedAt,
);

describeDatabase("Discord incident records with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS discord_watchdog_checks, discord_incident_signals, discord_incidents, discord_signals CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(renameFireflyToDiscord(sql));
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE discord_watchdog_checks, discord_incident_signals, discord_incidents, discord_signals"); });
  afterAll(async () => { await pool.end(); });

  it("deduplicates by fingerprint and affected version while retaining signal history and strongest score", async () => {
    const first = await recordDiscordSignal(pool, envelope(1), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const second = await recordDiscordSignal(pool, envelope(2, { severity: "critical", confidence: 0.8, deduplicationRelationship: "same", lastObservedAt: "2026-01-01T00:00:03.000Z" }), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const otherVersion = await recordDiscordSignal(pool, envelope(3, { affectedVersion: "2.0.0" }), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const incident = await attachDiscordSignalToIncident(pool, first.signalId);
    const updated = await attachDiscordSignalToIncident(pool, second.signalId);
    const separate = await attachDiscordSignalToIncident(pool, otherVersion.signalId);
    expect(updated.incidentId).toBe(incident.incidentId);
    expect(updated.signalCount).toBe(2);
    expect(updated.severity).toBe("critical");
    expect(updated.confidence).toBe(0.8);
    expect(updated.firstObservedAt).toBe(incident.firstObservedAt);
    expect(updated.lastObservedAt).toBe("2026-01-01T00:00:03.000Z");
    expect(separate.incidentId).not.toBe(incident.incidentId);
    expect(await listDiscordIncidents(pool)).toHaveLength(2);
    expect(await listDiscordSignals(pool)).toHaveLength(3);
    const retried = await attachDiscordSignalToIncident(pool, second.signalId);
    expect(retried).toEqual(updated);
  });

  it("records watchdog silence as uncertainty without creating a no-incident conclusion", async () => {
    const missing = await recordDiscordSilenceCheck(pool, null, "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 });
    expect(missing.state).toBe("uncertain");
    expect(missing.reason).toBe("discord_observation_missing");
    const silent = await recordDiscordSilenceCheck(pool, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 });
    expect(silent.state).toBe("uncertain");
    expect(silent.reason).toBe("discord_observation_silent");
    expect(await listDiscordIncidents(pool)).toHaveLength(0);
    expect(await listDiscordSilenceChecks(pool)).toHaveLength(2);
  });

  it("derives silence from the latest durable signal instead of caller observation text", async () => {
    await recordDiscordSignal(pool, envelope(1, { lastObservedAt: "2026-01-01T00:00:08.000Z", sourceFreshness: "2026-01-01T00:00:08.000Z" }, "2026-01-01T00:00:09.000Z"), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z"), freshnessWindowMs: 10_000 });
    const check = await recordDiscordSilenceCheck(pool, "1970-01-01T00:00:00.000Z", "2026-01-01T00:00:11.000Z", { maxSilenceMs: 10_000 });
    expect(check.state).toBe("observing");
    expect(check.lastObservedAt).toBe("2026-01-01T00:00:08.000Z");
    expect(check.silenceMs).toBe(3_000);
  });

  it("rolls back an accepted signal when atomic incident attachment fails", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION discord_test_fail_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'incident attachment failure'; END $$`);
    await pool.query("CREATE TRIGGER discord_test_fail_incident_trigger AFTER INSERT ON discord_incidents FOR EACH ROW EXECUTE FUNCTION discord_test_fail_incident()");
    const candidate = envelope(1, {}, "2026-01-01T00:00:05.000Z");
    try {
      await expect(recordDiscordSignal(pool, candidate, "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") })).rejects.toThrow();
      expect((await pool.query("SELECT 1 FROM discord_signals WHERE nonce = $1", [candidate.nonce])).rows).toHaveLength(0);
      expect((await listDiscordSignals(pool))).toHaveLength(0);
      expect(await listDiscordIncidents(pool)).toHaveLength(0);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS discord_test_fail_incident_trigger ON discord_incidents");
      await pool.query("DROP FUNCTION IF EXISTS discord_test_fail_incident()");
    }
  });

  it("rejects a direct SQL link when incident and signal identities differ", async () => {
    const first = await recordDiscordSignal(pool, envelope(1), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const second = await recordDiscordSignal(pool, envelope(2, { affectedVersion: "2.0.0" }), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    const incidents = await listDiscordIncidents(pool);
    const firstIncident = incidents.find((incident) => incident.affectedVersion === first.affectedVersion)!;
    expect(firstIncident).toBeDefined();
    await expect(pool.query("INSERT INTO discord_incident_signals (incident_id, signal_id) VALUES ($1, $2)", [firstIncident.incidentId, second.signalId])).rejects.toThrow();
  });

  it("redacts secret-like evidence before persistence and retrieval", async () => {
    const secret = "persist-secret-value";
    const stored = await recordDiscordSignal(pool, envelope(1, {
      minimalReproductionEvidence: [`Authorization: Bearer ${secret}`, `api_key: ${secret}`, `password=${secret}`, "safe evidence"],
    }), "discord-test-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await listDiscordSignals(pool))).not.toContain(secret);
    const raw = await pool.query<{ minimal_reproduction_evidence: string[] }>("SELECT minimal_reproduction_evidence FROM discord_signals WHERE signal_id = $1", [stored.signalId]);
    expect(JSON.stringify(raw.rows[0]?.minimal_reproduction_evidence)).not.toContain(secret);
    expect(JSON.stringify(raw.rows[0]?.minimal_reproduction_evidence)).toContain("[REDACTED]");
  });
});
