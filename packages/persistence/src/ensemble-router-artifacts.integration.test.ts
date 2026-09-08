import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type OperationalOverlay, type RoutingEvidence } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import {
  EnsembleRouterArtifactConflictError,
  EnsembleRouterArtifactIntegrityError,
  listRoutingEvidenceForGoal,
  readGoalOperationalOverlaySnapshot,
  readLatestOperationalOverlay,
  recordOperationalOverlay,
  recordRoutingEvidence,
  snapshotOperationalOverlayForGoalDurably,
} from "./ensemble-router-artifacts.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Ensemble Router artifacts with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  let pool: Pool;
  let connectionString: string;
  let schema: string;
  const installationRef = `installation-${randomUUID()}`;
  const projectRef = `project-${randomUUID()}`;

  const overlay = (version: number): OperationalOverlay => ({
    schemaVersion: 1,
    installationRef,
    projectRef,
    version,
    observations: [
      {
        candidateRef: "candidate-1",
        measuredLatencyMs: 10 + version,
        measuredCost: 0.01,
        failureRate: 0,
        timeoutRate: 0,
        providerErrorRate: 0,
        currentAvailability: true,
        accountBinding: "account-1",
        observedAt: "2026-09-08T12:00:00Z",
      },
    ],
  });
  const evidence = (goalRef: string, evidenceId = `evidence-${randomUUID()}`): RoutingEvidence => ({
    schemaVersion: 1,
    evidenceId,
    goalRef,
    projectRef,
    routeRef: `route-${randomUUID()}`,
    mode: "ensemble",
    selectedModelRef: "provider/model",
    accountBinding: "account-1",
    candidateRefs: ["candidate-1"],
    rejections: [],
    taskDemandHash: "a".repeat(64),
    pressure: 100,
    pressureBand: "high",
    decisionLayer: "Encore Council",
    overlayVersion: 1,
    admissionBindingRef: `binding-${randomUUID()}`,
    rationale: "selected after hard filters",
    createdAt: "2026-09-08T12:00:00Z",
  });

  beforeAll(async () => {
    schema = `ensemble_router_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    connectionString = url.toString();
    pool = new Pool({ connectionString });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE ensemble_router_routing_evidence, ensemble_router_goal_overlay_snapshots, ensemble_router_operational_overlays",
    );
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("writes real versioned overlays, isolates immutable Goal snapshots, and enforces content hashes", async () => {
    const first = overlay(1);
    const second = overlay(2);
    await expect(recordOperationalOverlay(pool, first)).resolves.toEqual(first);
    await expect(recordOperationalOverlay(pool, second)).resolves.toEqual(second);
    await expect(readLatestOperationalOverlay(pool, installationRef, projectRef)).resolves.toEqual(second);

    const goalOne = await snapshotOperationalOverlayForGoalDurably(pool, first, "goal-1");
    const goalTwo = await snapshotOperationalOverlayForGoalDurably(pool, second, "goal-2");
    expect(goalOne.overlayVersion).toBe(1);
    expect(goalTwo.overlayVersion).toBe(2);
    await expect(readGoalOperationalOverlaySnapshot(pool, "goal-1")).resolves.toEqual(goalOne);
    await expect(snapshotOperationalOverlayForGoalDurably(pool, second, "goal-1")).rejects.toBeInstanceOf(
      EnsembleRouterArtifactConflictError,
    );

    await expect(
      pool.query(
        "INSERT INTO ensemble_router_operational_overlays (installation_ref, project_ref, version, overlay, content_hash) VALUES ($1, $2, 99, $3::jsonb, $4)",
        [installationRef, projectRef, JSON.stringify(first), "bad"],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const rows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM ensemble_router_goal_overlay_snapshots");
    expect(rows.rows[0]!.count).toBe("2");
    const beforeMutation = await pool.query<{ snapshot: unknown; content_hash: string }>(
      "SELECT snapshot, content_hash FROM ensemble_router_goal_overlay_snapshots WHERE goal_ref = $1",
      ["goal-1"],
    );
    await expect(
      pool.query("UPDATE ensemble_router_goal_overlay_snapshots SET project_ref = $1 WHERE goal_ref = $2", ["tampered-project", "goal-1"]),
    ).rejects.toThrow();
    await expect(pool.query("DELETE FROM ensemble_router_goal_overlay_snapshots WHERE goal_ref = $1", ["goal-1"])).rejects.toThrow();
    const afterMutation = await pool.query<{ snapshot: unknown; content_hash: string }>(
      "SELECT snapshot, content_hash FROM ensemble_router_goal_overlay_snapshots WHERE goal_ref = $1",
      ["goal-1"],
    );
    expect(afterMutation.rows).toEqual(beforeMutation.rows);
  });

  it("binds each Goal snapshot to the exact durable overlay version", async () => {
    const stored = overlay(1);
    await recordOperationalOverlay(pool, stored);

    const forged = {
      ...stored,
      observations: [{ ...stored.observations[0]!, measuredLatencyMs: 999 }],
    };
    await expect(snapshotOperationalOverlayForGoalDurably(pool, forged, "goal-forged")).rejects.toBeInstanceOf(
      EnsembleRouterArtifactConflictError,
    );
    await expect(snapshotOperationalOverlayForGoalDurably(pool, { ...stored, version: 2 }, "goal-missing")).rejects.toBeInstanceOf(
      EnsembleRouterArtifactConflictError,
    );

    const before = await pool.query<{ overlay: unknown; content_hash: string }>(
      "SELECT overlay, content_hash FROM ensemble_router_operational_overlays WHERE installation_ref = $1 AND project_ref = $2 AND version = $3",
      [stored.installationRef, stored.projectRef, stored.version],
    );
    const snapshot = await snapshotOperationalOverlayForGoalDurably(pool, stored, "goal-bound");
    const sameVersion = await snapshotOperationalOverlayForGoalDurably(pool, stored, "goal-bound-2");
    expect(snapshot.overlayVersion).toBe(stored.version);
    expect(snapshot.observations).toEqual(stored.observations);
    expect(sameVersion.overlayVersion).toBe(snapshot.overlayVersion);
    expect(sameVersion.goalRef).not.toBe(snapshot.goalRef);
    const after = await pool.query<{ overlay: unknown; content_hash: string }>(
      "SELECT overlay, content_hash FROM ensemble_router_operational_overlays WHERE installation_ref = $1 AND project_ref = $2 AND version = $3",
      [stored.installationRef, stored.projectRef, stored.version],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("rejects a stored Goal snapshot whose payload hash was tampered", async () => {
    const stored = overlay(1);
    await recordOperationalOverlay(pool, stored);
    const payload = {
      schemaVersion: 1,
      installationRef: stored.installationRef,
      projectRef: stored.projectRef,
      goalRef: "goal-tampered",
      overlayVersion: stored.version,
      observations: stored.observations,
    };
    await pool.query(
      "INSERT INTO ensemble_router_goal_overlay_snapshots (goal_ref, installation_ref, project_ref, overlay_version, snapshot, content_hash) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
      [payload.goalRef, payload.installationRef, payload.projectRef, payload.overlayVersion, JSON.stringify(payload), "f".repeat(64)],
    );
    await expect(readGoalOperationalOverlaySnapshot(pool, payload.goalRef)).rejects.toBeInstanceOf(EnsembleRouterArtifactIntegrityError);
  });

  it("upgrades a non-empty 0072 evidence table without mutating its append-only rows", async () => {
    const legacySchema = `ensemble_router_legacy_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await basePool.query(`CREATE SCHEMA "${legacySchema}"`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${legacySchema}`);
    const legacyPool = new Pool({ connectionString: url.toString() });
    try {
      const migrationDir = fileURLToPath(new URL("../migrations/", import.meta.url));
      for (const name of readdirSync(migrationDir)
        .filter((entry) => entry <= "0072_ensemble_router_artifacts.sql")
        .sort()) {
        await legacyPool.query(readFileSync(`${migrationDir}${name}`, "utf8"));
      }
      const legacyEvidence = evidence("legacy-goal", "legacy-evidence");
      const { rejections: _rejections, ...legacyJson } = legacyEvidence;
      await legacyPool.query(
        "INSERT INTO ensemble_router_routing_evidence (evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref, account_binding, candidate_refs, task_demand_hash, pressure, pressure_band, decision_layer, overlay_version, admission_binding_ref, rationale, evidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)",
        [
          legacyEvidence.evidenceId,
          legacyEvidence.goalRef,
          legacyEvidence.projectRef,
          legacyEvidence.routeRef,
          legacyEvidence.mode,
          legacyEvidence.selectedModelRef,
          legacyEvidence.accountBinding,
          JSON.stringify(legacyEvidence.candidateRefs),
          legacyEvidence.taskDemandHash,
          legacyEvidence.pressure,
          legacyEvidence.pressureBand,
          legacyEvidence.decisionLayer,
          legacyEvidence.overlayVersion,
          legacyEvidence.admissionBindingRef,
          legacyEvidence.rationale,
          JSON.stringify(legacyJson),
        ],
      );
      await legacyPool.query(readFileSync(`${migrationDir}0073_routing_evidence_rejections.sql`, "utf8"));
      const upgraded = await legacyPool.query<{ rejections: unknown; evidence: Record<string, unknown> }>(
        "SELECT rejections, evidence FROM ensemble_router_routing_evidence WHERE evidence_id = $1",
        [legacyEvidence.evidenceId],
      );
      expect(upgraded.rows[0]!.rejections).toEqual([]);
      expect(upgraded.rows[0]!.evidence).not.toHaveProperty("rejections");
      await expect(
        legacyPool.query("UPDATE ensemble_router_routing_evidence SET rationale = 'tampered' WHERE evidence_id = $1", [
          legacyEvidence.evidenceId,
        ]),
      ).rejects.toThrow("append-only");
    } finally {
      await legacyPool.end();
      await basePool.query(`DROP SCHEMA "${legacySchema}" CASCADE`);
    }
  });

  it("uses the database append-only trigger for routing evidence and supports real reads", async () => {
    const goalRef = `goal-${randomUUID()}`;
    const value = evidence(goalRef);
    await expect(recordRoutingEvidence(pool, value)).resolves.toEqual(value);
    await expect(readLatestOperationalOverlay(pool, installationRef, projectRef)).resolves.toBeNull();
    await expect(listRoutingEvidenceForGoal(pool, goalRef)).resolves.toEqual([value]);
    await expect(
      pool.query("UPDATE ensemble_router_routing_evidence SET rationale = 'tampered' WHERE evidence_id = $1", [value.evidenceId]),
    ).rejects.toThrow("append-only");
    await expect(pool.query("DELETE FROM ensemble_router_routing_evidence WHERE evidence_id = $1", [value.evidenceId])).rejects.toThrow(
      "append-only",
    );
    const row = await pool.query<{ rationale: string }>("SELECT rationale FROM ensemble_router_routing_evidence WHERE evidence_id = $1", [
      value.evidenceId,
    ]);
    expect(row.rows[0]!.rationale).toBe(value.rationale);
  });
});
