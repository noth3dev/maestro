import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations as applyScopedMigrations } from "../../../packages/persistence/src/test-migrations.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const harnessPath = fileURLToPath(new URL("../dist/ipython-orphan-harness.js", import.meta.url));

describeDatabase("IPython production orphan restart", () => {
  const schema = `ipython_orphan_${randomUUID().replaceAll("-", "")}`;
  const basePool = databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl === undefined ? undefined : (() => {
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  const pool = scopedUrl === undefined ? undefined : new Pool({ connectionString: scopedUrl });
  const projectId = randomUUID();
  const goalId = randomUUID();
  const sessionId = `session-${randomUUID()}`;
  const children: ChildProcessWithoutNullStreams[] = [];

  beforeAll(async () => {
    await basePool!.query(`CREATE SCHEMA ${schema}`);
    await applyScopedMigrations(pool!);
    await pool!.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'draft', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
  });

  afterAll(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await pool!.end();
    await basePool!.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool!.end();
  });

  async function freePort(): Promise<number> {
    const { createServer } = await import("node:net");
    return await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") { server.close(); reject(new Error("free port lookup failed")); return; }
        server.close(() => resolve(address.port));
      });
    });
  }

  function spawnHarness(mode: "start" | "restart", port: number, instanceId: string, leaseMs: number): ChildProcessWithoutNullStreams {
    const child = spawn(process.execPath, [harnessPath], {
      env: {
        ...process.env,
        DATABASE_URL: scopedUrl!,
        MAESTRO_EVIDENCE_DIR: "/tmp/maestro-evidence",
        MAESTRO_WORKTREE_ROOT: process.cwd(),
        MAESTRO_HOST: "127.0.0.1",
        MAESTRO_PORT: String(port),
        MAESTRO_ACTOR_ID: "maestro-control-plane",
        MAESTRO_INSTANCE_ID: instanceId,
        MAESTRO_RECONCILER_LEASE_MS: String(leaseMs),
        MAESTRO_IPYTHON_PYTHON: "/usr/bin/python3",
        IPYTHON_HARNESS_MODE: mode,
        IPYTHON_HARNESS_SESSION_ID: sessionId,
        IPYTHON_HARNESS_PROJECT_ID: projectId,
        IPYTHON_HARNESS_GOAL_ID: goalId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    return child;
  }

  async function waitForJsonLine(child: ChildProcessWithoutNullStreams, type: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    return await new Promise((resolve, reject) => {
      let pending = "";
      let stderr = "";
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}; stderr=${stderr}`)), timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        for (;;) {
          const newline = pending.indexOf("\n");
          if (newline < 0) return;
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const value = JSON.parse(line) as Record<string, unknown>;
            if (value.type === type) { clearTimeout(timer); resolve(value); return; }
          } catch { /* ignore non-protocol diagnostics on stdout */ }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.once("exit", (code, signal) => { clearTimeout(timer); reject(new Error(`harness exited before ${type}: ${code}/${signal}; stderr=${stderr}`)); });
    });
  }

  async function waitForReconcilerLeaseExpiry(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await pool!.query<{ expired: boolean }>(
        "SELECT (expires_at <= transaction_timestamp()) AS expired FROM reconciler_leader_lease WHERE lease_key = 'singleton'",
      );
      if (result.rowCount === 0 || result.rows[0]!.expired) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("timed out waiting for IPython harness reconciliation lease expiry");
  }

  it("records production IPython started -> orphaned -> reaped across a real SIGKILL restart", async () => {
    const processA = spawnHarness("start", await freePort(), `ipython-a-${randomUUID()}`, 300);
    const started = await waitForJsonLine(processA, "started");
    const processRef = started.processRef;
    const processPid = started.processPid;
    expect(processRef).toEqual(expect.any(String));
    expect(processPid).toEqual(expect.any(Number));

    const startedRows = await pool!.query<{ event: string; process_ref: string; process_pid: number; details: Record<string, unknown> }>(
      "SELECT event, process_ref, process_pid, details FROM ipython_session_journal WHERE session_id = $1 ORDER BY journal_position",
      [sessionId],
    );
    expect(startedRows.rows).toHaveLength(1);
    expect(startedRows.rows[0]).toMatchObject({ event: "started", process_ref: processRef, process_pid: processPid });
    expect(startedRows.rows[0]!.details).toMatchObject({ process_group_id: String(processPid), process_session_id: expect.any(String), process_start_time: expect.any(String) });

    processA.kill("SIGKILL");
    await new Promise<void>((resolve) => processA.once("exit", () => resolve()));
    await waitForReconcilerLeaseExpiry(2_000);

    const processB = spawnHarness("restart", await freePort(), `ipython-b-${randomUUID()}`, 30_000);
    await waitForJsonLine(processB, "ready");
    const events = await pool!.query<{ event: string; process_ref: string }>(
      "SELECT event, process_ref FROM ipython_session_journal WHERE session_id = $1 ORDER BY journal_position",
      [sessionId],
    );
    expect(events.rows).toEqual([
      { event: "started", process_ref: processRef },
      { event: "orphaned", process_ref: processRef },
      { event: "reaped", process_ref: processRef },
    ]);
    expect(events.rows.some((row) => row.event === "completed" || row.event === "cancelled")).toBe(false);

    processB.kill("SIGKILL");
    await new Promise<void>((resolve) => processB.once("exit", () => resolve()));
  }, 30_000);
});
