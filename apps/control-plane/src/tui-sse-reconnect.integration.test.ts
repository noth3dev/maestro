import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiClient, type GoalEvent } from "@maestro/api-client";
import { bootstrapLocalOperator } from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { advanceWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession, type WorkspaceSession } from "../../cli/src/tui/session.js";
import { readDashboard } from "../../cli/src/tui/commands/read-commands.js";
import { runActivityStream, subscribeToEvents } from "../../cli/src/tui/activity-stream.js";
import type { TranscriptLine } from "../../cli/src/tui/theme.js";
import { renderStatusHeader } from "../../cli/src/tui/components/shell.js";
import { createControlPlane } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const workspace = { cwd: "/tmp/maestro-s3-workspace", gitRoot: "/tmp/maestro-s3-workspace" };

const databaseConfig = databaseUrl === undefined ? undefined : (() => {
  const schema = `tui_sse_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return { schema, basePool, scopedUrl: url.toString() };
})();

function renderDashboard(dashboard: Awaited<ReturnType<typeof readDashboard>>) {
  const goal = dashboard.selectedGoal;
  return renderStatusHeader({
    workspace,
    connection: { kind: "connected" },
    goal: goal === undefined
      ? { kind: "empty" }
      : { kind: "value", value: { name: goal.goalId, state: goal.state } },
    workers: dashboard.workerCount === undefined ? { kind: "empty" } : { kind: "value", value: dashboard.workerCount },
    approvals: { kind: "empty" },
    budget: dashboard.budget === undefined
      ? { kind: "empty" }
      : { kind: "value", value: { spentCents: dashboard.budget.costCents, ceilingCents: dashboard.budget.budgetCents } },
  }, 80).join("\n");
}

describeDatabase("TUI SSE cursor and failure semantics against real PostgreSQL", () => {
  if (databaseConfig === undefined) return;
  const { schema, basePool, scopedUrl } = databaseConfig;
  let setupPool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    setupPool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(setupPool);
  });

  beforeEach(async () => {
    await setupPool.query("TRUNCATE reconciler_leader_lease, goal_controls, goal_leases, outbox, goal_events, command_receipts, goals, local_operator_credentials, local_operators CASCADE");
  });

  afterAll(async () => {
    await setupPool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("renders the durable Goal through the same API state and persists the cursor across a forced disconnect", async () => {
    const secret = `s3-secret-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(setupPool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(setupPool, operatorId, projectId);
    await grantProjectRole(setupPool, operatorId, projectId, "concertmaster");
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
      actorId: "maestro-control-plane", leaseOwnerId: `s3-${randomUUID()}`,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    const firstGoalId = randomUUID();
    const secondGoalId = randomUUID();
    const create = async (goalId: string) => fetch(`${baseUrl}/v1/goals`, {
      method: "POST", headers: { ...headers, "idempotency-key": goalId }, body: JSON.stringify({ projectId }),
    });
    const sessionRoot = mkdtempSync(join(tmpdir(), "maestro-s3-session-"));

    try {
      expect((await create(firstGoalId)).status).toBe(201);
      expect((await create(secondGoalId)).status).toBe(201);
      const client = createApiClient({ baseUrl, token: `${credentialId}.${secret}` });
      const dashboard = await readDashboard({ client, projectId, goalId: firstGoalId });
      expect(dashboard.selectedGoal?.goalId).toBe(firstGoalId);
      expect(renderDashboard(dashboard)).toContain(`${firstGoalId} · draft`);

      const durablePage = await client.listEvents({ projectId, after: "0" });
      const durableIds = durablePage.events.map((event) => event.eventId);
      expect(durablePage.events.length).toBeGreaterThanOrEqual(2);
      const calls: string[] = [];
      let streamAttempt = 0;
      const streamClient = {
        streamEvents(query: { projectId: string; after: string }, options: { signal: AbortSignal }): AsyncIterable<GoalEvent> {
          calls.push(query.after);
          streamAttempt += 1;
          const upstream = client.streamEvents(query, options);
          if (streamAttempt !== 1) return upstream;
          return (async function* () {
            for await (const event of upstream) {
              yield event;
              throw new Error("forced SSE disconnect");
            }
          })();
        },
      };

      const firstController = new AbortController();
      const firstReceived: GoalEvent[] = [];
      let session: WorkspaceSession = { workspacePath: workspace.cwd, projectId };
      for await (const event of subscribeToEvents({ client: streamClient, projectId, signal: firstController.signal, cursor: "0", reconnectDelayMs: 0, maxReconnectAttempts: 0 })) {
        firstReceived.push(event);
        session = advanceWorkspaceSession(workspace.cwd, session, event);
        await saveWorkspaceSession(session, sessionRoot);
      }
      expect(firstReceived).toHaveLength(1);
      const persisted = await loadWorkspaceSession(workspace.cwd, sessionRoot);
      expect(persisted?.lastEventCursor).toBe(firstReceived[0]!.cursor);

      const resumedController = new AbortController();
      const resumedReceived: GoalEvent[] = [];
      for await (const event of subscribeToEvents({
        client: streamClient, projectId, signal: resumedController.signal, cursor: persisted?.lastEventCursor,
        reconnectDelayMs: 0, maxReconnectAttempts: 0,
      })) {
        resumedReceived.push(event);
        resumedController.abort();
      }

      expect(resumedReceived[0]?.eventId).toBe(durableIds[1]);
      expect([...firstReceived, ...resumedReceived].map((event) => event.eventId)).toEqual(durableIds.slice(0, 2));
      expect(new Set([...firstReceived, ...resumedReceived].map((event) => event.eventId)).size).toBe(2);
      expect(calls).toEqual(["0", firstReceived[0]!.cursor]);

    } finally {
      rmSync(sessionRoot, { recursive: true, force: true });
      await controlPlane.close();
    }
  });

  it("renders explicit unavailable and authorization failures without fabricating Goal state", async () => {
    const secret = `s3-auth-secret-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(setupPool, { secret });
    const projectId = randomUUID();
    await grantProjectMembership(setupPool, operatorId, projectId);
    await grantProjectRole(setupPool, operatorId, projectId, "concertmaster");
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0,
      actorId: "maestro-control-plane", leaseOwnerId: `s3-auth-${randomUUID()}`,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const consumeFailure = async (client: Parameters<typeof runActivityStream>[0]["client"], streamProjectId = projectId) => {
      const controller = new AbortController();
      const failures: TranscriptLine[] = [];
      const unavailable: TranscriptLine[] = [];
      const events: GoalEvent[] = [];
      const savedCursors: string[] = [];
      await runActivityStream({
        client, projectId: streamProjectId, signal: controller.signal, cursor: "0", reconnectDelayMs: 0, maxReconnectAttempts: 0,
        onEvent: (event) => { events.push(event); savedCursors.push(event.cursor); },
        onFailure: (message) => failures.push(message),
        onUnavailable: (message) => unavailable.push(message),
      });
      return { failures, unavailable, events, savedCursors };
    };

    try {
      const unauthorized = createApiClient({ baseUrl, token: "not-a-valid-token" });
      const unauthorizedResult = await consumeFailure(unauthorized);
      expect(unauthorizedResult.failures[0]?.text).toContain("authorization required");
      expect(unauthorizedResult.failures[0]?.kind).toBe("error");
      expect(unauthorizedResult.unavailable).toEqual([]);
      expect(unauthorizedResult.events).toEqual([]);
      expect(unauthorizedResult.savedCursors).toEqual([]);

      const forbidden = createApiClient({ baseUrl, token: `${credentialId}.${secret}` });
      const forbiddenResult = await consumeFailure(forbidden, randomUUID());
      expect(forbiddenResult.failures[0]?.text).toContain("authorization denied");
      expect(forbiddenResult.failures[0]?.kind).toBe("error");
      expect(forbiddenResult.unavailable).toEqual([]);
      expect(forbiddenResult.events).toEqual([]);
      expect(forbiddenResult.savedCursors).toEqual([]);

      const unavailable = createApiClient({
        baseUrl: "https://maestro.test", token: "secret",
        fetch: async () => new Response(JSON.stringify({ error: { code: "provider_unavailable", message: "Gateway unavailable" } }), { status: 503 }),
      });
      const unavailableResult = await consumeFailure(unavailable);
      expect(unavailableResult.unavailable[0]?.text).toContain("Activity stream unavailable");
      expect(unavailableResult.unavailable[0]?.text).toContain("Gateway unavailable");
      expect(unavailableResult.unavailable[0]?.kind).toBe("error");
      expect(unavailableResult.failures).toEqual([]);
      expect(unavailableResult.events).toEqual([]);
      expect(unavailableResult.savedCursors).toEqual([]);
    } finally {
      await controlPlane.close();
    }
  });

});
