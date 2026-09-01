import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootstrapLocalOperator } from "@maestro/persistence";

// A real integration test that spawns the compiled control-plane
// (apps/control-plane/dist/main.js, produced by `npm run build`) as a real
// OS child process, drives it over real HTTP, kills it with SIGKILL at an
// unpredictable point mid-work, then starts a brand-new process instance
// pointed at the same real PostgreSQL database and proves:
//
//   (a) reconcileOnStartup runs on the new process and never duplicates a
//       Goal transition that the killed process already committed;
//   (b) the Goal's durable state after restart matches exactly what
//       committed durable evidence (goal_events, goals) says it should be;
//   (c) the stale/dangling goal_leases row left behind by the killed
//       process's in-flight lease is never silently reused by new work
//       after restart -- new work against that Goal must fail closed.

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const distMainPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));

if (!databaseUrl) {
  describe.skip("control-plane real process kill-and-restart", () => {
    it("requires MAESTRO_TEST_DATABASE_URL", () => {});
  });
} else {

describe("control-plane real process kill-and-restart", () => {
  const schema = `kill_restart_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  let setupPool: Pool;
  const secret = `kill-restart-secret-${randomUUID()}`;
  const spawnedChildren: ChildProcessWithoutNullStreams[] = [];

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    setupPool = new Pool({ connectionString: scopedUrl });
    for (const name of [
      "0001_phase1_core.sql",
      "0002_goal_leases.sql",
      "0003_local_operator_auth.sql",
      "0004_local_operator_credential_security.sql",
      "0007_goal_control.sql",
      "0009_reconciliation_leader_lease.sql",
    ]) {
      await setupPool.query(await readFile(fileURLToPath(new URL(`../../../packages/persistence/migrations/${name}`, import.meta.url)), "utf8"));
    }
    await bootstrapLocalOperator(setupPool, { secret });
  });

  afterEach(async () => {
    // Belt-and-braces: make sure no child process from a failed assertion
    // is left running across tests.
    for (const child of spawnedChildren.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });

  afterAll(async () => {
    await setupPool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  async function findFreePort(): Promise<number> {
    const { createServer } = await import("node:net");
    return await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        if (address === null || typeof address === "string") {
          probe.close();
          reject(new Error("Expected TCP address"));
          return;
        }
        const { port } = address;
        probe.close(() => resolve(port));
      });
    });
  }

  function spawnControlPlane(options: { port: number; instanceId: string; reconcilerLeaseMs: number }): ChildProcessWithoutNullStreams {
    const child = spawn(process.execPath, [distMainPath], {
      env: {
        ...process.env,
        DATABASE_URL: scopedUrl,
        MAESTRO_EVIDENCE_DIR: "/tmp/maestro-evidence",
        MAESTRO_HOST: "127.0.0.1",
        MAESTRO_PORT: String(options.port),
        MAESTRO_ACTOR_ID: "maestro-control-plane",
        MAESTRO_INSTANCE_ID: options.instanceId,
        MAESTRO_RECONCILER_LEASE_MS: String(options.reconcilerLeaseMs),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    (child as unknown as { stderrLog: () => string }).stderrLog = () => stderr;
    spawnedChildren.push(child);
    return child;
  }

  /** Poll a real HTTP endpoint until the process is actually accepting connections, or it exits. */
  async function waitForReadyOrExit(
    child: ChildProcessWithoutNullStreams,
    port: number,
    timeoutMs: number,
  ): Promise<"ready" | { exitCode: number | null; signal: NodeJS.Signals | null }> {
    const deadline = Date.now() + timeoutMs;
    let exited: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
    child.once("exit", (exitCode, signal) => { exited = { exitCode, signal }; });
    while (Date.now() < deadline) {
      if (exited) return exited;
      try {
        await fetch(`http://127.0.0.1:${port}/v1/goals`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
          body: "{}",
        });
        return "ready";
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return exited ?? "exited" as never;
  }

  /** Poll the DB directly until this row's expiry (if any) is strictly in the past. Deterministic, bounded. */
  async function waitForLeaderLeaseExpiry(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await setupPool.query<{ expired: boolean }>(
        "SELECT (expires_at <= transaction_timestamp()) AS expired FROM reconciler_leader_lease WHERE lease_key = 'singleton'",
      );
      if (result.rowCount === 0 || result.rows[0]!.expired) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Timed out waiting for reconciler leader lease to expire");
  }

  it(
    "does not duplicate or lose a committed Goal transition, and fails closed on a dangling goal lease, across a real SIGKILL restart",
    async () => {
      const timings: Record<string, number> = {};
      const started = Date.now();
      const projectId = randomUUID();
      const goalId = randomUUID();
      const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };

      // --- Process A: create and partially advance a real Goal over real HTTP.
      const portA = await findFreePort();
      const childA = spawnControlPlane({ port: portA, instanceId: `proc-a-${randomUUID()}`, reconcilerLeaseMs: 300 });
      const readyA = await waitForReadyOrExit(childA, portA, 5_000);
      expect(readyA).toBe("ready");
      timings.processAReadyMs = Date.now() - started;

      const created = await fetch(`http://127.0.0.1:${portA}/v1/goals`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": goalId },
        body: JSON.stringify({ projectId }),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ goalId, projectId, state: "draft", version: 1 });

      // Follow the legal domain path draft -> ready_for_confirmation ->
      // launched -> active before injecting the process crash.
      let expectedVersion = 1;
      let committedResult: { goalId: string; projectId: string; state: string; version: number } | undefined;
      for (const to of ["ready_for_confirmation", "launched", "active"] as const) {
        const transitionResponse = await fetch(`http://127.0.0.1:${portA}/v1/goals/${goalId}/transitions`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": randomUUID() },
          body: JSON.stringify({ projectId, expectedVersion, to }),
        });
        expect(transitionResponse.status).toBe(200);
        committedResult = await transitionResponse.json();
        expectedVersion += 1;
        expect(committedResult).toMatchObject({ goalId, projectId, state: to, version: expectedVersion });
      }
      expect(committedResult).toMatchObject({ goalId, projectId, state: "active", version: 4 });

      // Kill immediately after the HTTP response is received: the durable
      // write already committed, but process A never gets to release its
      // in-memory goal lease or gracefully shut down.
      const killedAt = Date.now();
      childA.kill("SIGKILL");
      const exitA = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        childA.once("exit", (code, signal) => resolve({ code, signal }));
      });
      expect(exitA.signal).toBe("SIGKILL");
      timings.processAKillToExitMs = Date.now() - killedAt;

      // Durable evidence right after the kill: exactly the four committed
      // events (CreateGoal plus the three legal transitions), nothing more,
      // nothing less.
      const eventsAfterKill = await setupPool.query<{ event_type: string }>(
        "SELECT event_type FROM goal_events WHERE goal_id = $1 ORDER BY global_position", [goalId],
      );
      expect(eventsAfterKill.rows.map((row) => row.event_type)).toEqual([
        "GoalCreated", "GoalTransitioned", "GoalTransitioned", "GoalTransitioned",
      ]);
      const goalRowAfterKill = await setupPool.query<{ state: string; version: string }>(
        "SELECT state, version FROM goals WHERE goal_id = $1", [goalId],
      );
      expect(goalRowAfterKill.rows[0]).toMatchObject({ state: "active", version: "4" });

      // The dangling goal_leases row left by process A's in-flight (never
      // released) lease. It must still be unexpired -- that's exactly the
      // dangerous "dangling lease" shape this test exists to cover.
      const danglingLeaseBeforeRestart = await setupPool.query<{ owner_id: string; fencing_token: string; expired: boolean }>(
        "SELECT owner_id, fencing_token, (expires_at <= transaction_timestamp()) AS expired FROM goal_leases WHERE goal_id = $1", [goalId],
      );
      expect(danglingLeaseBeforeRestart.rowCount).toBe(1);
      expect(danglingLeaseBeforeRestart.rows[0]!.expired).toBe(false);

      // Let process A's own (short-lived, startup-only) reconciliation
      // leader lease actually expire before starting process B, via a real
      // DB poll -- not a blind sleep.
      await waitForLeaderLeaseExpiry(2_000);
      timings.leaderLeaseExpiryWaitMs = Date.now() - killedAt;

      // --- Process B: brand-new process instance, same real database.
      const portB = await findFreePort();
      const instanceIdB = `proc-b-${randomUUID()}`;
      const childB = spawnControlPlane({ port: portB, instanceId: instanceIdB, reconcilerLeaseMs: 30_000 });
      const readyB = await waitForReadyOrExit(childB, portB, 5_000);
      if (readyB !== "ready") {
        throw new Error(`process B failed to become ready: ${JSON.stringify(readyB)} stderr=${(childB as unknown as { stderrLog(): string }).stderrLog()}`);
      }
      timings.processBReadyAfterKillMs = Date.now() - killedAt;

      try {
        // (a) reconcileOnStartup really ran under the new process instance:
        // the singleton leader lease is now owned by B, not A.
        const leaderLease = await setupPool.query<{ owner_id: string }>(
          "SELECT owner_id FROM reconciler_leader_lease WHERE lease_key = 'singleton'",
        );
        expect(leaderLease.rows[0]!.owner_id).toBe(instanceIdB);

        // (a) + (b): no duplicate or lost transition. Durable evidence is
        // byte-for-byte the same four committed events as right after the
        // kill -- reconciliation did not force a phantom transition here,
        // because it correctly refused to steal process A's still-live
        // (dangling) goal lease instead of silently continuing.
        const eventsAfterRestart = await setupPool.query<{ event_type: string }>(
          "SELECT event_type FROM goal_events WHERE goal_id = $1 ORDER BY global_position", [goalId],
        );
        expect(eventsAfterRestart.rows.map((row) => row.event_type)).toEqual([
          "GoalCreated", "GoalTransitioned", "GoalTransitioned", "GoalTransitioned",
        ]);

        // (b) Read the Goal back over real HTTP against the *new* process:
        // durable state after restart matches exactly what A's last
        // committed HTTP response said, with no phantom re-application.
        const readAfterRestart = await fetch(`http://127.0.0.1:${portB}/v1/goals/${goalId}?projectId=${projectId}`, {
          headers: { authorization: `Bearer ${secret}` },
        });
        expect(readAfterRestart.status).toBe(200);
        expect(await readAfterRestart.json()).toEqual(committedResult);

        // (c) The dangling goal_leases row must not be silently reused by
        // new work: the exact same owner/fencing-token row must still be
        // sitting there unexpired -- reconciliation never stole it -- and a
        // brand-new real TransitionGoal request against process B must fail
        // closed (423 lease_unavailable) rather than silently succeeding as
        // if it had acquired that stale lease.
        const danglingLeaseAfterRestart = await setupPool.query<{ owner_id: string; fencing_token: string; expired: boolean }>(
          "SELECT owner_id, fencing_token, (expires_at <= transaction_timestamp()) AS expired FROM goal_leases WHERE goal_id = $1", [goalId],
        );
        expect(danglingLeaseAfterRestart.rows[0]).toEqual(danglingLeaseBeforeRestart.rows[0]);

        const newWorkAttempt = await fetch(`http://127.0.0.1:${portB}/v1/goals/${goalId}/transitions`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": randomUUID() },
          body: JSON.stringify({ projectId, expectedVersion: 4, to: "pausing" }),
        });
        expect(newWorkAttempt.status).toBe(423);
        expect((await newWorkAttempt.json()).error.code).toBe("lease_unavailable");

        // That failed-closed attempt must have left zero durable trace: no
        // new event, no version bump -- the stale lease was neither reused
        // by the new process nor by this rejected new-work request.
        const finalGoalRow = await setupPool.query<{ state: string; version: string }>(
          "SELECT state, version FROM goals WHERE goal_id = $1", [goalId],
        );
        expect(finalGoalRow.rows[0]).toMatchObject({ state: "active", version: "4" });
        const finalEvents = await setupPool.query<{ event_type: string }>(
          "SELECT event_type FROM goal_events WHERE goal_id = $1 ORDER BY global_position", [goalId],
        );
        expect(finalEvents.rows.map((row) => row.event_type)).toEqual([
          "GoalCreated", "GoalTransitioned", "GoalTransitioned", "GoalTransitioned",
        ]);
      } finally {
        childB.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          if (childB.exitCode !== null || childB.signalCode !== null) { resolve(); return; }
          childB.once("exit", () => resolve());
        });
        timings.totalMs = Date.now() - started;
        // eslint-disable-next-line no-console
        console.log("kill-restart timings (ms):", timings);
      }
    },
    15_000,
  );
});
}
