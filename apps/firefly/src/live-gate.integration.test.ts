import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildFireflyIncidentBrief,
  deriveFireflyIncidentFingerprint,
  routeFireflyIncidentDepartments,
  signFireflySignal,
  type AuthenticatedFireflySignal,
  type FireflySignal,
} from "@maestro/domain";
import {
  applyAllMigrations,
  acquireGoalLease,
  recordFireflySignal,
  linkFireflyIncidentToGoal,
  closeFireflyIncident,
  listFireflyIncidents,
  listFireflySignals,
} from "@maestro/persistence";
import { localGitPort } from "@maestro/git-adapter";
import { createFirefly } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const secret = "firefly-live-gate-secret";
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}` });

function signal(overrides: Partial<FireflySignal> = {}): FireflySignal {
  const now = Date.now();
  const value: FireflySignal = {
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
    fireflyHealthState: "healthy",
    ...overrides,
  };
  return { ...value, incidentFingerprint: deriveFireflyIncidentFingerprint(value) };
}

describeDatabase("Phase 4 exit gate: Firefly detects a seeded incident while the control plane is unavailable, delivers once recovered, and dedupes", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS firefly_improvement_evidence, firefly_watchdog_checks, firefly_incident_signals, firefly_incidents, firefly_signals, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("buffers a seeded incident signal while the control plane is down, delivers it once recovered, deduplicates a repeat, and activates only the minimal correct triage organization without an unapproved critical effect", async () => {
    const bufferPath = join(await mkdtemp(join(tmpdir(), "firefly-live-gate-")), "buffer.jsonl");
    let controlPlaneHealthy = false;
    const delivered: AuthenticatedFireflySignal[] = [];
    let sequence = 0;

    const firefly = createFirefly(
      { bufferPath, credential: secret, flushIntervalMs: 100, freshnessWindowMs: 300_000 },
      {
        deliver: async (envelope) => {
          if (!controlPlaneHealthy) throw new Error("control plane unavailable");
          await recordFireflySignal(pool, envelope, secret);
          delivered.push(envelope);
        },
      },
    );

    // 1. Seed the incident signal while the control plane is unavailable.
    sequence += 1;
    const seeded = signFireflySignal(signal(), secret, randomUUID(), sequence);
    await firefly.emit(seeded);
    expect(firefly.pendingCount()).toBe(1);
    expect(await listFireflySignals(pool)).toHaveLength(0);

    // 2. Recovery: the control plane comes back; the buffered signal is
    // delivered and durably recorded exactly once.
    controlPlaneHealthy = true;
    await firefly.flush();
    expect(firefly.pendingCount()).toBe(0);
    expect(delivered).toHaveLength(1);
    const storedSignals = await listFireflySignals(pool);
    expect(storedSignals).toHaveLength(1);

    const incidents = await listFireflyIncidents(pool, storedSignals[0]!.incidentFingerprint);
    expect(incidents).toHaveLength(1);
    const incident = incidents[0]!;
    expect(incident.signalCount).toBe(1);

    // 3. A repeated observation of the same real anomaly updates the one
    // incident identity; it never creates a duplicate.
    sequence += 1;
    const repeat = signFireflySignal(signal({ deduplicationRelationship: "same" }), secret, randomUUID(), sequence);
    await firefly.emit(repeat);
    await firefly.flush();
    const afterRepeat = await listFireflyIncidents(pool, storedSignals[0]!.incidentFingerprint);
    expect(afterRepeat).toHaveLength(1);
    expect(afterRepeat[0]!.incidentId).toBe(incident.incidentId);
    expect(afterRepeat[0]!.signalCount).toBe(2);

    // 4. Activates only the correct, minimal triage organization for a
    // crash-classified incident (never a broader routing).
    const brief = buildFireflyIncidentBrief(afterRepeat[0]!, storedSignals[0]!.minimalReproductionEvidence, "crash");
    expect(routeFireflyIncidentDepartments("crash")).toEqual(["operations", "engineering"]);
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
    const linked = await linkFireflyIncidentToGoal(pool, incident.incidentId, goalId, proof, context("sane"));
    expect(linked.status).toBe("triaging");
    expect((localGitPort as Record<string, unknown>).push).toBeUndefined();
    expect((localGitPort as Record<string, unknown>).merge).toBeUndefined();

    // 6. Independent certification outcome closes the incident with
    // retained-risk evidence, matching plan/phase4.md's "Close with
    // resolution, retained risk, false-positive result, and Firefly
    // feedback."
    const closed = await closeFireflyIncident(pool, incident.incidentId, "resolved", "Health endpoint capacity increased and independently certified.", "monitor for recurrence for 7 days", context("sane"));
    expect(closed.status).toBe("resolved");
    expect(closed.linkedGoalId).toBe(goalId);
  });
});
