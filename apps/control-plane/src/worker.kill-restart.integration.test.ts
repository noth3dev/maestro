import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash } from "@maestro/domain";
import {
  acquireGoalLease,
  applyAllMigrations,
  bootstrapLocalOperator,
  bootstrapPermanentOrganization,
  createDepartmentPlan,
  createHeadCouncil,
  createMissionBundle,
  grantProjectMembership,
  grantProjectRole,
  readWorker,
  recordCouncilDecisionPacket,
  releaseGoalLease,
  revealCouncilBriefs,
  submitIndependentBrief,
} from "@maestro/persistence";
import { createControlPlane } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const providerHarnessPath = fileURLToPath(new URL("./process-provider-tcp-harness.mjs", import.meta.url));
const controlPlaneHarnessPath = fileURLToPath(new URL("./process-control-plane-harness.mjs", import.meta.url));

const brief = {
  interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [],
  dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [],
};
const contractContent = (projectId: string) => ({
  desiredOutcome: "deliver safely", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
  project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" }, evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
  budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
});
const plan = {
  contribution: "own the product slice", nonGoals: [],
  items: [{ itemId: "scout-1", kind: "scout", objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase5/product", integrationPath: "packages/product", risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
};
const bundle = {
  role: "scout", profileRef: "profile-1", goalBrief: "assess risk before implementation", approvedModels: ["model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"], costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"], terminationConditions: ["deadline passed"],
};

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<{ port: number }> {
  let buffer = "";
  return await new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "") continue;
        try {
          const message = JSON.parse(line) as { ready?: boolean; port?: number };
          if (message.ready !== true || typeof message.port !== "number") continue;
          child.stdout.off("data", onData);
          resolve({ port: message.port });
          return;
        } catch { /* wait for the next complete line */ }
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code, signal) => reject(new Error(`harness exited before ready: ${code ?? signal}`)));
  });
}

async function startProvider(): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const child = spawn(process.execPath, [providerHarnessPath], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const { port } = await waitForReady(child);
  return { child, port };
}

async function startControlPlane(config: Record<string, unknown>, providerPort: number, extraEnv: Record<string, string> = {}): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const child = spawn(process.execPath, [controlPlaneHarnessPath], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv, MAESTRO_PROVIDER_PORT: String(providerPort), MAESTRO_CONTROL_PLANE_CONFIG: JSON.stringify(config) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const { port } = await waitForReady(child);
    return { child, port };
  } catch (error) {
    child.kill("SIGKILL");
    await waitForExit(child);
    throw error;
  }
}

async function providerRequest(port: number, op: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const socket = await new Promise<import("node:net").Socket>((resolve, reject) => {
    const next = new net.Socket();
    next.connect(port, "127.0.0.1", () => resolve(next));
    next.once("error", reject);
  });
  socket.setEncoding("utf8");
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.off("data", onData);
      try {
        const result = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
        if (typeof result.error === "string") reject(new Error(result.error)); else resolve(result);
      } catch (error) { reject(error); }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
  socket.write(`${JSON.stringify({ id: 1, op, ...payload })}\n`);
  try { return await response; } finally { socket.end(); }
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

async function waitForProviderSpawn(port: number, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const stats = await providerRequest(port, "stats");
    if (stats.spawnCount === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`provider did not report spawn count ${expected}`);
}

async function setupWorkerGraph(pool: Pool, projectId: string) {
  const goalId = randomUUID();
  const contractId = randomUUID();
  const content = contractContent(projectId);
  await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
  await pool.query("INSERT INTO goal_controls (goal_id, project_id) VALUES ($1, $2)", [goalId, projectId]);
  await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(content), taskContractContentHash(content)]);
  await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')", [goalId, contractId]);
  const proof = await acquireGoalLease(pool, { goalId, ownerId: `fixture-${randomUUID()}`, leaseDurationMs: 60_000 });
  const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: [] } }, proof, { actorId: "secretary", sessionRef: "session:secretary", commandId: randomUUID() });
  await submitIndependentBrief(pool, council.councilId, "product", brief, proof, { actorId: "head:product", sessionRef: "opaque:product", commandId: randomUUID() });
  await revealCouncilBriefs(pool, council.councilId, proof, { actorId: "secretary", sessionRef: "session:secretary", commandId: randomUUID() });
  const decided = await recordCouncilDecisionPacket(pool, council.councilId, {
    outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "own it" }], workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
  }, proof, { actorId: "secretary", sessionRef: "session:secretary", commandId: randomUUID() });
  const departmentPlan = await createDepartmentPlan(pool, { councilId: decided.councilId, departmentId: "product", substance: plan }, proof, { actorId: "head:product", sessionRef: "opaque:product", commandId: randomUUID() });
  await createMissionBundle(pool, { councilId: decided.councilId, departmentId: "product", itemId: "scout-1", substance: bundle }, proof, { actorId: "head:product", sessionRef: "opaque:product", commandId: randomUUID() });
  await releaseGoalLease(pool, proof);
  return { goalId, councilId: decided.councilId, planVersion: departmentPlan.version };
}

describeDatabase("real HTTP worker recovery with a process-backed provider", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `worker_process_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE reconciler_leader_lease, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, goal_controls, goal_leases, outbox, goal_events, command_receipts, goals, operator_project_memberships, local_operator_credentials, local_operators CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("fences a reservation when SIGKILL lands after provider spawn but before ref binding", async () => {
    const secret = `worker-bind-window-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-product");
    const graph = await setupWorkerGraph(pool, projectId);
    const provider = await startProvider();
    let controlPlaneA: { child: ChildProcessWithoutNullStreams; port: number } | undefined;
    let controlPlaneB: { child: ChildProcessWithoutNullStreams; port: number } | undefined;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    try {
      const ownerA = `owner-bind-window-${randomUUID()}`;
      controlPlaneA = await startControlPlane({
        databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
        primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: ownerA, reconcilerLeaseDurationMs: 30_000, shutdownDrainTimeoutMs: 100,
      }, provider.port, { MAESTRO_TEST_SPAWN_RETURN_DELAY_MS: "5000" });
      const request = fetch(`http://127.0.0.1:${controlPlaneA.port}/v1/councils/${graph.councilId}/departments/product/workers`, {
        method: "POST", headers: { ...auth, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, planVersion: graph.planVersion, itemId: "scout-1" }),
      }).catch(() => undefined);
      await waitForProviderSpawn(provider.port, 1);
      const pending = await pool.query<{ worker_id: string; execution_ref: string; invocation_ref: string; status: string }>(
        "SELECT worker_id, execution_ref, invocation_ref, status FROM workers WHERE council_id = $1", [graph.councilId],
      );
      expect(pending.rows).toHaveLength(1);
      expect(pending.rows[0]).toMatchObject({ status: "spawned", execution_ref: expect.stringMatching(/^pending:/), invocation_ref: expect.stringMatching(/^pending:/) });
      const workerId = pending.rows[0]!.worker_id;
      controlPlaneA.child.kill("SIGKILL");
      await waitForExit(controlPlaneA.child);
      controlPlaneA = undefined;
      await request;

      await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [graph.goalId]);
      await pool.query("UPDATE reconciler_leader_lease SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE lease_key = 'singleton'");
      const ownerB = `owner-bind-successor-${randomUUID()}`;
      controlPlaneB = await startControlPlane({
        databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
        primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: ownerB, reconcilerLeaseDurationMs: 30_000, shutdownDrainTimeoutMs: 100,
      }, provider.port);
      await expect(readWorker(pool, workerId)).resolves.toMatchObject({
        status: "unknown", recoveryState: "fenced", executionRef: expect.stringMatching(/^pending:/), invocationRef: expect.stringMatching(/^pending:/), ownerId: `reconciler:${ownerB}`,
      });
      const decisions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM worker_recovery_decisions WHERE worker_id = $1", [workerId]);
      expect(decisions.rows[0]!.count).toBe(1);
      const stats = await providerRequest(provider.port, "stats");
      expect(stats.spawnCount).toBe(1);
      const retry = await fetch(`http://127.0.0.1:${controlPlaneB.port}/v1/councils/${graph.councilId}/departments/product/workers`, {
        method: "POST", headers: { ...auth, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, planVersion: graph.planVersion, itemId: "scout-1" }),
      });
      expect(retry.status).toBe(409);
      expect((await retry.json()).error.code).toBe("council_conflict");
    } finally {
      if (controlPlaneA !== undefined && controlPlaneA.child.exitCode === null) { controlPlaneA.child.kill("SIGKILL"); await waitForExit(controlPlaneA.child); }
      if (controlPlaneB !== undefined && controlPlaneB.child.exitCode === null) { controlPlaneB.child.kill("SIGTERM"); await waitForExit(controlPlaneB.child); }
      if (provider.child.exitCode === null) { provider.child.kill("SIGTERM"); await waitForExit(provider.child); }
    }
  });

  it("fences exactly once across killed control-plane processes while the provider survives", async () => {
    const secret = `worker-process-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-product");
    const graph = await setupWorkerGraph(pool, projectId);
    const provider = await startProvider();
    let controlPlaneA: { child: ChildProcessWithoutNullStreams; port: number } | undefined;
    let controlPlaneB: { child: ChildProcessWithoutNullStreams; port: number } | undefined;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    let workerId: string;
    try {
      const ownerA = `owner-a-${randomUUID()}`;
      controlPlaneA = await startControlPlane({
        databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
        primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: ownerA, reconcilerLeaseDurationMs: 30_000, shutdownDrainTimeoutMs: 100,
      }, provider.port);
      const response = await fetch(`http://127.0.0.1:${controlPlaneA.port}/v1/councils/${graph.councilId}/departments/product/workers`, {
        method: "POST", headers: { ...auth, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, planVersion: graph.planVersion, itemId: "scout-1" }),
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { workerId: string; executionRef: string; invocationRef: string; status: string };
      expect(body.status).toBe("spawned");
      expect(body.executionRef).toMatch(/^provider-/);
      expect(body.invocationRef).toMatch(/^provider-/);
      workerId = body.workerId;

      // A real OS kill leaves the provider-side invocation alive and the
      // durable owner lease to expire; no graceful cleanup is requested.
      controlPlaneA.child.kill("SIGKILL");
      const controlPlaneAExit = await waitForExit(controlPlaneA.child);
      expect(controlPlaneAExit.signal).toBe("SIGKILL");
      controlPlaneA = undefined;

      await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [graph.goalId]);
      await pool.query("UPDATE reconciler_leader_lease SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE lease_key = 'singleton'");
      const ownerB = `owner-b-${randomUUID()}`;
      controlPlaneB = await startControlPlane({
        databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
        primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: ownerB, reconcilerLeaseDurationMs: 30_000, shutdownDrainTimeoutMs: 100,
      }, provider.port);
      const recovered = await readWorker(pool, workerId!);
      expect(recovered).toMatchObject({ status: "unknown", recoveryState: "fenced", executionRef: expect.stringMatching(/^provider-/), invocationRef: expect.stringMatching(/^provider-/), ownerId: `reconciler:${ownerB}` });
      const decisions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM worker_recovery_decisions WHERE worker_id = $1", [workerId!]);
      expect(decisions.rows[0]!.count).toBe(1);
      const providerStats = await providerRequest(provider.port, "stats");
      expect(providerStats.spawnCount).toBe(1);
      const invocations = providerStats.invocations as [string, { status: string }][];
      expect(invocations).toHaveLength(1);
      expect(invocations[0]![1].status).toBe("running");
      const read = await fetch(`http://127.0.0.1:${controlPlaneB.port}/v1/workers/${workerId!}?projectId=${projectId}`, { headers: { authorization: `Bearer ${credentialId}.${secret}` } });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ workerId: workerId!, status: "unknown" });
      const retry = await fetch(`http://127.0.0.1:${controlPlaneB.port}/v1/councils/${graph.councilId}/departments/product/workers`, {
        method: "POST", headers: { ...auth, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, planVersion: graph.planVersion, itemId: "scout-1" }),
      });
      const retryBody = await retry.json();
      expect(retry.status).toBe(409);
      expect(retryBody.error.code).toBe("council_conflict");
    } finally {
      if (controlPlaneA !== undefined && controlPlaneA.child.exitCode === null) { controlPlaneA.child.kill("SIGKILL"); await waitForExit(controlPlaneA.child); }
      if (controlPlaneB !== undefined && controlPlaneB.child.exitCode === null) { controlPlaneB.child.kill("SIGTERM"); await waitForExit(controlPlaneB.child); }
      if (provider.child.exitCode === null) { provider.child.kill("SIGTERM"); await waitForExit(provider.child); }
    }
  });

});
