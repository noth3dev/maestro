import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapAuthorityRecord, bootstrapLocalOperator, revokeAuthorityRecord } from "@maestro/persistence";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { createControlPlane } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("control-plane composition root", () => {
    it("requires MAESTRO_TEST_DATABASE_URL", () => {});
  });
} else {
  describe("control-plane composition root", () => {
  const schema = `control_plane_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  let setupPool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    setupPool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(setupPool);
  });

  beforeEach(async () => {
    await setupPool.query(
      "TRUNCATE reconciler_leader_lease, authority_decisions, authority_records, goal_controls, goal_leases, outbox, goal_events, command_receipts, goals, local_operator_credentials, local_operators CASCADE",
    );
  });

  afterAll(async () => {
    await setupPool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("serves authenticated durable Goal operations over a real loopback listener and closes resources", async () => {
    const secret = "integration-secret-not-configured";
    await bootstrapLocalOperator(setupPool, { secret });
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      host: "127.0.0.1",
      port: 0,
      primeAgentVersion: "0.8.0",
      actorId: "maestro-control-plane",
      leaseOwnerId: `test-${randomUUID()}`,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectId = randomUUID();
    const goalId = randomUUID();

    try {
      const unauthorized = await fetch(`${baseUrl}/v1/goals`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": goalId },
        body: JSON.stringify({ projectId }),
      });
      expect(unauthorized.status).toBe(401);
      expect((await setupPool.query("SELECT count(*)::int AS count FROM goals")).rows[0]!.count).toBe(0);

      const headers = {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": goalId,
      };
      const created = await fetch(`${baseUrl}/v1/goals`, { method: "POST", headers, body: JSON.stringify({ projectId }) });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ goalId, projectId, state: "draft", version: 1 });

      const transitioned = await fetch(`${baseUrl}/v1/goals/${goalId}/transitions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": randomUUID() },
        body: JSON.stringify({ projectId, expectedVersion: 1, to: "ready_for_confirmation" }),
      });
      expect(transitioned.status).toBe(200);
      expect(await transitioned.json()).toMatchObject({ goalId, projectId, state: "ready_for_confirmation", version: 2 });

      const read = await fetch(`${baseUrl}/v1/goals/${goalId}?projectId=${projectId}`, { headers: { authorization: `Bearer ${secret}` } });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ goalId, projectId, state: "ready_for_confirmation", version: 2 });
    } finally {
      await controlPlane.close();
    }

    await expect(controlPlane.pool.query("SELECT 1")).rejects.toThrow();
  });

  it("streams durable replay over loopback, resumes without duplicate IDs, and stops on disconnect", async () => {
    const secret = "sse-secret-not-configured";
    await bootstrapLocalOperator(setupPool, { secret });
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `sse-${randomUUID()}` });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectId = randomUUID();
    const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const create = async (goalId: string) => fetch(`${baseUrl}/v1/goals`, { method: "POST", headers: { ...headers, "idempotency-key": goalId }, body: JSON.stringify({ projectId }) });
    const readChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>, label: string) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 1_000); }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };
    const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, predicate: (text: string) => boolean, label: string) => {
      const decoder = new TextDecoder();
      let text = "";
      while (!predicate(text)) {
        const chunk = await readChunk(reader, label);
        if (chunk.done) throw new Error(`SSE closed while waiting for ${label}`);
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    };
    try {
      await create(randomUUID());
      await create(randomUUID());
      const first = await fetch(`${baseUrl}/v1/events/stream?projectId=${projectId}&after=0`, { headers });
      expect(first.status).toBe(200);
      const firstReader = first.body!.getReader();
      const firstText = await readUntil(firstReader, (text) => [...text.matchAll(/^id: (.+)$/gm)].length === 2, "initial replay");
      const ids = [...firstText.matchAll(/^id: (.+)$/gm)].map((match) => match[1]!);
      expect(ids).toHaveLength(2);
      await firstReader.cancel();

      const resumed = await fetch(`${baseUrl}/v1/events/stream?projectId=${projectId}&after=${ids[0]}`, { headers: { ...headers, "last-event-id": ids[0]! } });
      const resumedReader = resumed.body!.getReader();
      const resumedText = await readUntil(resumedReader, (text) => /^id: /m.test(text), "resumed event");
      expect([...resumedText.matchAll(/^id: (.+)$/gm)].map((match) => match[1]!)).toEqual([ids[1]]);
      await resumedReader.cancel();

      const empty = await fetch(`${baseUrl}/v1/events/stream?projectId=${projectId}&after=${ids[1]}`, { headers });
      const emptyReader = empty.body!.getReader();
      const heartbeat = await readUntil(emptyReader, (text) => text.includes(": heartbeat\n\n"), "heartbeat");
      expect(heartbeat).toContain(": heartbeat\n\n");
      await create(randomUUID());
      const later = await readUntil(emptyReader, (text) => text.includes("event: goal-event"), "polled event");
      expect(later).toContain("event: goal-event");
      expect(later).not.toContain(`id: ${ids[1]}`);
      await emptyReader.cancel();
      await controlPlane.close();
      await expect(controlPlane.pool.query("SELECT 1")).rejects.toThrow();
    } finally {
      await controlPlane.close();
    }
  });

  it("closes an open raw SSE response within a bounded interval", async () => {
    const secret = "sse-close-secret-not-configured";
    await bootstrapLocalOperator(setupPool, { secret });
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `sse-close-${randomUUID()}` });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events/stream?projectId=${randomUUID()}`, { headers: { authorization: `Bearer ${secret}` } });
    const reader = response.body!.getReader();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([
        controlPlane.close(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("app.close did not release open SSE")), 1_000); }),
      ])).resolves.toBeUndefined();
      let readerTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            while (!(await reader.read()).done) {
              // A response may have buffered bytes. It must still reach EOF after app.close().
            }
          })(),
          new Promise<never>((_, reject) => { readerTimeout = setTimeout(() => reject(new Error("SSE reader did not close")), 1_000); }),
        ]);
      } finally {
        if (readerTimeout) clearTimeout(readerTimeout);
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      await reader.cancel().catch(() => undefined);
      await controlPlane.close();
    }
  });

  it("runs reconcileOnStartup before serving traffic and records the leader lease", async () => {
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      host: "127.0.0.1",
      port: 0,
      primeAgentVersion: "0.8.0",
      actorId: "maestro-control-plane",
      leaseOwnerId: `startup-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
    });
    try {
      await controlPlane.listen();
      const address = controlPlane.app.server.address();
      if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
      const leaseRow = await setupPool.query<{ owner_id: string }>(
        "SELECT owner_id FROM reconciler_leader_lease WHERE lease_key = 'singleton'",
      );
      expect(leaseRow.rowCount).toBe(1);
      expect(leaseRow.rows[0]!.owner_id).toBe(controlPlane.config.leaseOwnerId);
    } finally {
      await controlPlane.close();
    }
  });

  it("fails closed and never binds a listener when the reconciliation leader lease is already held", async () => {
    await setupPool.query(
      `INSERT INTO reconciler_leader_lease (lease_key, owner_id, fencing_token, expires_at)
       VALUES ('singleton', 'other-instance', 1, transaction_timestamp() + interval '1 minute')`,
    );
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      host: "127.0.0.1",
      port: 0,
      primeAgentVersion: "0.8.0",
      actorId: "maestro-control-plane",
      leaseOwnerId: `blocked-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
    });
    try {
      await expect(controlPlane.listen()).rejects.toThrow(
        "Reconciliation leader lease is currently held by another instance",
      );
      expect(controlPlane.app.server.listening).toBe(false);
      const leaseRow = await setupPool.query<{ owner_id: string }>(
        "SELECT owner_id FROM reconciler_leader_lease WHERE lease_key = 'singleton'",
      );
      expect(leaseRow.rows[0]!.owner_id).toBe("other-instance");
    } finally {
      await controlPlane.close();
    }
  });


  it("proves the full HTTP authority boundary: no approval blocks the effect, an exact approval invokes it once, and a revoked approval blocks it again", async () => {
    const secret = `critical-action-secret-${randomUUID()}`;
    const localOperator = await bootstrapLocalOperator(setupPool, { secret });
    const effect = vi.fn(async () => {});
    const controlPlane = createControlPlane(
      { databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `critical-${randomUUID()}` },
      { criticalActionEffect: effect },
    );
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectId = randomUUID();
    const goalId = randomUUID();
    const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const body = { projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0 };

    try {
      // (a) No bootstrapped approval yet: the durable gateway requires approval and the effect is never called.
      const firstCommandId = randomUUID();
      const pending = await fetch(`${baseUrl}/v1/goals/${goalId}/critical-actions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": firstCommandId },
        body: JSON.stringify(body),
      });
      expect(pending.status).toBe(409);
      expect(await pending.json()).toMatchObject({ error: { code: "critical_action_requires_approval" } });
      expect(effect).not.toHaveBeenCalled();
      const auditedPending = await setupPool.query(
        "SELECT outcome FROM authority_decisions WHERE project_id = $1 AND goal_id = $2 AND command_id = $3",
        [projectId, goalId, firstCommandId],
      );
      expect(auditedPending.rows).toEqual([{ outcome: "require_approval" }]);

      // (b) Bootstrap the exact approval for a new commandId: the gateway allows it and invokes the effect exactly once.
      const approvedCommandId = randomUUID();
      const approval = await bootstrapAuthorityRecord(setupPool, {
        kind: "approval",
        commandId: approvedCommandId,
        projectId,
        goalId,
        actorId: localOperator.operatorId,
        action: body.action,
        target: body.target,
        policyVersion: body.policyVersion,
        budgetEffectCents: body.budgetEffectCents,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const allowed = await fetch(`${baseUrl}/v1/goals/${goalId}/critical-actions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": approvedCommandId },
        body: JSON.stringify(body),
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ goalId, effect: "allow", recordId: approval.recordId });
      expect(effect).toHaveBeenCalledTimes(1);
      const auditedAllowed = await setupPool.query(
        "SELECT outcome, matched_record_id FROM authority_decisions WHERE project_id = $1 AND goal_id = $2 AND command_id = $3",
        [projectId, goalId, approvedCommandId],
      );
      expect(auditedAllowed.rows).toEqual([{ outcome: "allow", matched_record_id: approval.recordId }]);

      // (c) Revoke the approval, then retry the same exact command: the gateway denies it and the effect is not called again.
      await revokeAuthorityRecord(setupPool, approval.recordId);
      const revoked = await fetch(`${baseUrl}/v1/goals/${goalId}/critical-actions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": approvedCommandId },
        body: JSON.stringify(body),
      });
      expect(revoked.status).toBe(409);
      expect(await revoked.json()).toMatchObject({ error: { code: "critical_action_requires_approval" } });
      expect(effect).toHaveBeenCalledTimes(1);
      const auditedRevoked = await setupPool.query(
        "SELECT outcome FROM authority_decisions WHERE project_id = $1 AND goal_id = $2 AND command_id = $3 ORDER BY decided_at",
        [projectId, goalId, approvedCommandId],
      );
      expect(auditedRevoked.rows).toEqual([{ outcome: "allow" }, { outcome: "require_approval" }]);

    } finally {
      await controlPlane.close();
    }
  });

});
}
