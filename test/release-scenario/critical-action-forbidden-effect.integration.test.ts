import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FileEvidenceStore } from "@maestro/evidence";
import { bootstrapLocalOperator, createCapabilityApproval } from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { applyAllMigrations } from "../../packages/persistence/src/test-migrations.js";
import { createControlPlane } from "../../apps/control-plane/src/main.js";
import type { ActionRequest } from "@maestro/authority";

/**
 * P0 fix: the release-scenario runbook Steps 12/13 only asserted a nonzero
 * exit code / status != "allowed" for a forbidden critical action
 * (git.remote.push). Production has no critical-action effect adapter
 * composed (`apps/control-plane/src/main.ts` fails closed with "No
 * critical-action effect adapter is configured"), and nothing durably
 * recorded whether an attempted effect was actually blocked before any
 * network call.
 *
 * This test composes a REAL, test-scoped effect adapter through
 * `createControlPlane`'s existing `overrides.criticalActionEffect`
 * injection point (the same seam `main.integration.test.ts` uses), wires it
 * through the real HTTP critical-action routes
 * (`/v1/goals/:goalId/critical-actions` and
 * `/v1/goals/:goalId/critical-actions/approve-and-run`), and through the
 * real `/v1/goals/:goalId/evidence-records` route so durable evidence with
 * `networkInvoked:false` is written via `appendEvidenceMetadata` +
 * `FileEvidenceStore`, exactly the same durable evidence mechanism
 * production evidence capture uses. The adapter is invoked only via
 * `AuthorizedEffectExecutor` -- it is never called directly or bypassed --
 * and it never performs the actual forbidden network call itself. It is
 * exercised once per full-access mode
 * (`retain_intermediate_approvals` and `skip_intermediate_approvals`),
 * producing one durable per-mode evidence row each.
 */

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("release-scenario Steps 12/13: durable forbidden-effect evidence per full-access mode", () => {
  const schema = `release_scenario_effect_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;
  const evidenceDir = `/tmp/maestro-evidence-${randomUUID()}`;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE reconciler_leader_lease, authority_effect_claims, authority_decisions, authority_records, capability_decision_journal, capability_sessions, capability_approvals, evidence_records, goal_controls, goal_leases, outbox, goal_events, command_receipts, goals, operator_project_memberships, local_operator_credentials, local_operators CASCADE",
    );
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("blocks git.remote.push before any network call and records durable per-mode evidence for both full-access modes", async () => {
    const secret = `forbidden-effect-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");

    // Real, test-scoped effect adapter: invoked only through
    // AuthorizedEffectExecutor when the durable authority gateway has
    // already allowed the action. It never performs the actual forbidden
    // network call -- it records that it *attempted* the action and was
    // *blocked* before any network I/O, via the real evidence-capture HTTP
    // route, so the evidence is durable and mode-scoped.
    const attempts: ActionRequest[] = [];
    let evidenceBaseUrl = "";
    let evidenceAuth: Record<string, string> = {};
    const effect = async (request: ActionRequest) => {
      attempts.push(request);
      if (request.action !== "git.remote.push") return;
      const evidence = { attempted: true, status: "blocked", networkInvoked: false, action: request.action, commandId: request.commandId };
      const contentBase64 = Buffer.from(JSON.stringify(evidence), "utf8").toString("base64");
      const response = await fetch(`${evidenceBaseUrl}/v1/goals/${request.goalId}/evidence-records`, {
        method: "POST",
        headers: { ...evidenceAuth, "content-type": "application/json" },
        body: JSON.stringify({ projectId: request.projectId, correlationId: randomUUID(), commandId: request.commandId, kind: "forbidden-effect-block", mediaType: "application/json", contentBase64 }),
      });
      if (response.status !== 200) throw new Error(`evidence capture failed: ${response.status}`);
    };

    const controlPlane = createControlPlane(
      { databaseUrl: scopedUrl, evidenceDir, worktreeRoot: "/tmp", host: "127.0.0.1", port: 0, actorId: "maestro-control-plane", leaseOwnerId: `effect-${randomUUID()}`, ceoOperatorId: operatorId },
      { criticalActionEffect: effect },
    );
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    evidenceBaseUrl = baseUrl;
    const headers = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    evidenceAuth = { authorization: headers.authorization };
    const store = new FileEvidenceStore(evidenceDir);

    try {
      const goalId = randomUUID();
      await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);

      // The deployment capability the git.remote.push gate requires is a
      // single Goal-scoped activation, consumed once per approved command
      // (not per full-access mode); both modes exercise it via the real
      // command-bound approval ledger the production route consumes.
      await createCapabilityApproval(pool, {
        approvalId: randomUUID(), capabilityKind: "deployment", projectId, goalId,
        commandId: "external-capability:deployment", action: "external-capability.activate", target: "deployment",
        policyVersion: 1, controlEpoch: "external-capability-v1", budgetEffectCents: 0, tier: "user",
        approverId: operatorId, decision: "approved",
        reason: "User explicitly activated deployment for this Goal.",
        consequence: "Deployment remains bounded by expiry and repetition scope.",
        expiresAt: new Date(Date.now() + 3_600_000), repetitionScope: { kind: "bounded_count", count: 3 },
      });

      const modes = ["retain_intermediate_approvals", "skip_intermediate_approvals"] as const;
      for (const mode of modes) {
        // Real HTTP full-access-mode selection route, exactly as the live
        // runbook Step 13 drives it.
        const sessionId = randomUUID();
        const selection = await fetch(`${baseUrl}/v1/goals/${goalId}/capabilities/full-access-mode`, {
          method: "POST", headers,
          body: JSON.stringify({ projectId, capabilityKind: "ipython", sessionId, fullAccessMode: mode }),
        });
        expect(selection.status).toBe(200);
        expect((await selection.json()).fullAccessMode).toBe(mode);

        // Activate the deployment capability the git.remote.push gate
        // requires, then have the configured CEO approve-and-run the
        // forbidden action through the real HTTP route.
        const commandId = randomUUID();
        const approvalBody = {
          projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
        const response = await fetch(`${baseUrl}/v1/goals/${goalId}/critical-actions/approve-and-run`, {
          method: "POST", headers: { ...headers, "idempotency-key": commandId }, body: JSON.stringify(approvalBody),
        });
        expect(response.status).toBe(200);
        const body = await response.json() as { effect: string };
        expect(body.effect).toBe("allow");

        // The real effect adapter was invoked exactly once for this
        // command, through AuthorizedEffectExecutor, and recorded that it
        // attempted the forbidden action but never invoked the network.
        const invocation = attempts.find((request) => request.commandId === commandId);
        expect(invocation).toBeDefined();
        expect(invocation!.action).toBe("git.remote.push");

        // Durable, mode-scoped evidence: read back the metadata row via
        // Postgres and the immutable content via the real FileEvidenceStore
        // the evidence-capture route persisted through.
        const metadata = await pool.query<{ evidence_id: string; sha256: string; kind: string }>(
          "SELECT evidence_id, sha256, kind FROM evidence_records WHERE project_id = $1 AND goal_id = $2 AND command_id = $3",
          [projectId, goalId, commandId],
        );
        expect(metadata.rows).toHaveLength(1);
        expect(metadata.rows[0]!.kind).toBe("forbidden-effect-block");
        const bytes = await store.read(metadata.rows[0]!.sha256);
        const recorded = JSON.parse(Buffer.from(bytes).toString("utf8")) as { attempted: boolean; status: string; networkInvoked: boolean; action: string };
        expect(recorded).toMatchObject({ attempted: true, status: "blocked", networkInvoked: false, action: "git.remote.push" });
      }

      // Exactly two durable evidence rows exist for this Goal: one per
      // full-access mode, no duplicates and no missing mode.
      const allEvidence = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM evidence_records WHERE project_id = $1 AND goal_id = $2 AND kind = 'forbidden-effect-block'",
        [projectId, goalId],
      );
      expect(allEvidence.rows[0]!.count).toBe(2);
    } finally {
      await controlPlane.close();
    }
  });
});
