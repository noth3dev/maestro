import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapLocalOperator } from "@maestro/persistence";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { executeCli } from "../../cli/src/main.js";
import { createControlPlane } from "../../control-plane/src/main.js";
import { loadGoalPageData } from "./goal-page.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("CLI and Secretary durable-truth parity", () => {
    it("requires MAESTRO_TEST_DATABASE_URL", () => {});
  });
} else {
  describe("CLI and Secretary durable-truth parity", () => {
    const schema = `cli_secretary_parity_${randomUUID().replaceAll("-", "")}`;
    const basePool = new Pool({ connectionString: databaseUrl });
    const scopedUrl = (() => {
      const url = new URL(databaseUrl);
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

    it("shows the exact CLI-created durable Goal and event history in Secretary", async () => {
      const secret = "cli-secretary-parity-test-secret";
      const projectId = randomUUID();
      const goalId = randomUUID();
      await bootstrapLocalOperator(setupPool, { secret });
      const controlPlane = createControlPlane({
        databaseUrl: scopedUrl,
        evidenceDir: "/tmp/maestro-evidence",
        host: "127.0.0.1",
        port: 0,
        primeAgentVersion: "0.8.0",
        actorId: "maestro-control-plane",
        leaseOwnerId: `cli-secretary-parity-${randomUUID()}`,
      });
      await controlPlane.listen();
      const address = controlPlane.app.server.address();
      if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
      const apiUrl = `http://127.0.0.1:${address.port}`;
      const env = { MAESTRO_API_URL: apiUrl, MAESTRO_API_TOKEN: secret };
      const stdout: string[] = [];
      const stderr: string[] = [];
      const io = { stdout: (line: string) => { stdout.push(line); }, stderr: (line: string) => { stderr.push(line); } };

      try {
        expect(await executeCli(["goal", "create", "--project-id", projectId, "--command-id", goalId, "--json"], env, io)).toBe(0);
        const created = JSON.parse(stdout.at(-1)!) as { goalId: string; projectId: string; state: string; version: number };
        expect(created).toEqual({ goalId, projectId, state: "draft", version: 1 });

        expect(await executeCli([
          "goal", "transition", "--goal-id", goalId, "--project-id", projectId,
          "--expected-version", String(created.version), "--to", "ready_for_confirmation",
          "--command-id", randomUUID(), "--json",
        ], env, io)).toBe(0);
        const transitioned = JSON.parse(stdout.at(-1)!) as typeof created;
        expect(transitioned).toEqual({ ...created, state: "ready_for_confirmation", version: 2 });

        expect(await executeCli(["events", "list", "--project-id", projectId, "--json"], env, io)).toBe(0);
        const cliEvents = JSON.parse(stdout.at(-1)!) as { events: unknown[]; nextCursor: string };
        const secretary = await loadGoalPageData({ apiUrl, token: secret, projectId, goalId });

        expect(stderr).toEqual([]);
        expect(secretary.goal).toEqual(transitioned);
        expect(secretary.goal.goalId).toBe(created.goalId);
        expect(secretary.goal.version).toBe(transitioned.version);
        expect(secretary.events).toEqual(cliEvents.events);
      } finally {
        await controlPlane.close();
      }
    });
  });
}
