import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildDiscordIncidentBrief,
  deriveDiscordIncidentFingerprint,
  routeDiscordIncidentDepartments,
  signDiscordSignal,
  type AuthenticatedDiscordSignal,
  type DiscordSignal,
} from "@maestro/domain";
import {
  applyAllMigrations,
  acquireGoalLease,
  recordDiscordSignal,
  linkDiscordIncidentToGoal,
  closeDiscordIncident,
  listDiscordIncidents,
  listDiscordSignals,
} from "@maestro/persistence";
import { localGitPort } from "../../../test/git-port.js";
import { createDiscord } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const secret = "discord-live-gate-secret";
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}` });

function signal(overrides: Partial<DiscordSignal> = {}): DiscordSignal {
  const now = Date.now();
  const value: DiscordSignal = {
    incidentFingerprint: "",
    firstObservedAt: new Date(now - 2000).toISOString(),
    lastObservedAt: new Date(now - 1000).toISOString(),
    severity: "critical",
    confidence: 0.6,
    affectedComponent: "control-plane-health-endpoint",
    affectedVersion: "2.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "health-probe",
    sourceFreshness: new Date(now - 1000).toISOString(),
    deduplicationRelationship: "new",
    discordHealthState: "healthy",
    ...overrides,
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
}

describeDatabase("Phase 4 exit gate: Discord detects a seeded incident while the control plane is unavailable, delivers once recovered, and dedupes", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS discord_improvement_evidence, discord_watchdog_checks, discord_incident_signals, discord_incidents, discord_signals, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("buffers a seeded incident signal while the control plane is down, delivers it once recovered, deduplicates a repeat, and activates only the minimal correct triage organization without an unapproved critical effect", async () => {
    const bufferPath = join(await mkdtemp(join(tmpdir(), "discord-live-gate-")), "buffer.jsonl");
    let controlPlaneHealthy = false;
    const delivered: AuthenticatedDiscordSignal[] = [];
    let sequence = 0;

    const discord = createDiscord(
      { bufferPath, credential: secret, flushIntervalMs: 100, freshnessWindowMs: 300_000 },
      {
        deliver: async (envelope) => {
          if (!controlPlaneHealthy) throw new Error("control plane unavailable");
          await recordDiscordSignal(pool, envelope, secret);
          delivered.push(envelope);
        },
      },
    );

    // 1. Seed the incident signal while the control plane is unavailable.
    sequence += 1;
    const seeded = signDiscordSignal(signal(), secret, randomUUID(), sequence);
    await discord.emit(seeded);
    expect(discord.pendingCount()).toBe(1);
    expect(await listDiscordSignals(pool)).toHaveLength(0);

    // 2. Recovery: the control plane comes back; the buffered signal is
    // delivered and durably recorded exactly once.
    controlPlaneHealthy = true;
    await discord.flush();
    expect(discord.pendingCount()).toBe(0);
    expect(delivered).toHaveLength(1);
    const storedSignals = await listDiscordSignals(pool);
    expect(storedSignals).toHaveLength(1);

    const incidents = await listDiscordIncidents(pool, storedSignals[0]!.incidentFingerprint);
    expect(incidents).toHaveLength(1);
    const incident = incidents[0]!;
    expect(incident.signalCount).toBe(1);

    // 3. A repeated observation of the same real anomaly updates the one
    // incident identity; it never creates a duplicate.
    sequence += 1;
    const repeat = signDiscordSignal(signal({ deduplicationRelationship: "same" }), secret, randomUUID(), sequence);
    await discord.emit(repeat);
    await discord.flush();
    const afterRepeat = await listDiscordIncidents(pool, storedSignals[0]!.incidentFingerprint);
    expect(afterRepeat).toHaveLength(1);
    expect(afterRepeat[0]!.incidentId).toBe(incident.incidentId);
    expect(afterRepeat[0]!.signalCount).toBe(2);

    // 4. Activates only the correct, minimal triage organization for a
    // crash-classified incident (never a broader routing).
    const brief = buildDiscordIncidentBrief(afterRepeat[0]!, storedSignals[0]!.minimalReproductionEvidence, "crash");
    expect(routeDiscordIncidentDepartments("crash")).toEqual(["operations", "engineering"]);
    expect(brief.routedDepartments).toEqual(["operations", "engineering"]);
    expect(brief.routedDepartments).not.toContain("security");

    // 5. Drives isolated remediation: the incident is linked to a real Goal,
    // and the only Git capability available structurally has no push or
    // merge -- an unapproved critical effect is impossible, not merely
    // policy-denied.
    const goalId = randomUUID();
    const projectId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 60_000 });
    const linked = await linkDiscordIncidentToGoal(pool, incident.incidentId, goalId, proof, context("concertmaster"));
    expect(linked.status).toBe("triaging");
    expect((localGitPort as Record<string, unknown>).push).toBeUndefined();
    expect((localGitPort as Record<string, unknown>).merge).toBeUndefined();

    // 6. Independent certification outcome closes the incident with
    // retained-risk evidence, matching plan/phase4.md's "Close with
    // resolution, retained risk, false-positive result, and Discord
    // feedback."
    const closed = await closeDiscordIncident(pool, incident.incidentId, "resolved", "Health endpoint capacity increased and independently certified.", "monitor for recurrence for 7 days", context("concertmaster"), proof);
    expect(closed.status).toBe("resolved");
    expect(closed.linkedGoalId).toBe(goalId);
  });
});
