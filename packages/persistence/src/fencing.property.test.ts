import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acquireGoalLease, executeGoalCommand, renewGoalLease, type GoalCommand, type GoalLeaseProof } from "./commands.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

/**
 * A fencing token that is structurally valid (matches isValidFencingToken's
 * exact base-10 bigint bounds) but is not the current owner-current token
 * for a lease under test.
 */
const arbitraryForgedFencingToken = fc
  .bigInt({ min: 1n, max: 9223372036854775807n })
  .map((value) => value.toString());

const arbitraryText = fc.stringMatching(/^[a-zA-Z0-9-]{1,32}$/);

async function counts(pool: Pool): Promise<{ receipts: number; events: number; goals: number; outbox: number }> {
  const result = await pool.query<{ receipts: number; events: number; goals: number; outbox: number }>(
    `SELECT (SELECT count(*)::int FROM command_receipts) receipts,
            (SELECT count(*)::int FROM goal_events) events,
            (SELECT count(*)::int FROM goals) goals,
            (SELECT count(*)::int FROM outbox) outbox`,
  );
  return result.rows[0]!;
}

describeDatabase("Goal lease fencing property tests with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    for (const name of ["0001_phase1_core.sql", "0002_goal_leases.sql"]) {
      const migration = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(migration);
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE goal_leases, outbox, goal_events, goals, command_receipts RESTART IDENTITY CASCADE");
  });

  afterAll(async () => { await pool.end(); });

  it("rejects every generated stale-token CreateGoal command with zero durable writes", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryForgedFencingToken, arbitraryText, async (forgedToken, ownerSuffix) => {
        const goalId = randomUUID();
        const projectId = randomUUID();
        const owner = `owner-${ownerSuffix}`;
        const current = await acquireGoalLease(pool, { goalId, ownerId: owner, leaseDurationMs: 60_000 });
        fc.pre(forgedToken !== current.fencingToken);

        const before = await counts(pool);
        const command: GoalCommand = {
          commandId: randomUUID(), projectId, goalId, actorId: "operator",
          type: "CreateGoal", expectedVersion: 0,
        };
        const forgedProof: GoalLeaseProof = { goalId, ownerId: owner, fencingToken: forgedToken };
        await expect(executeGoalCommand(pool, command, forgedProof)).rejects.toMatchObject({ code: "stale_lease" });
        await expect(counts(pool)).resolves.toEqual(before);

        // The real current proof still works afterward: forging did not corrupt the lease.
        await expect(executeGoalCommand(pool, command, current)).resolves.toMatchObject({ outcome: "succeeded" });
      }),
      { numRuns: 25 },
    );
  });

  it("rejects every generated stale-token TransitionGoal command with zero durable writes", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryForgedFencingToken, arbitraryText, async (forgedToken, ownerSuffix) => {
        const goalId = randomUUID();
        const projectId = randomUUID();
        const owner = `owner-${ownerSuffix}`;
        const createProof = await acquireGoalLease(pool, { goalId, ownerId: owner, leaseDurationMs: 60_000 });
        await executeGoalCommand(
          pool,
          { commandId: randomUUID(), projectId, goalId, actorId: "operator", type: "CreateGoal", expectedVersion: 0 },
          createProof,
        );
        const currentAfterCreate = await renewGoalLease(pool, createProof, 60_000);
        fc.pre(forgedToken !== currentAfterCreate.fencingToken);

        const before = await counts(pool);
        const transition: GoalCommand = {
          commandId: randomUUID(), projectId, goalId, actorId: "operator",
          type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation",
        };
        const forgedProof: GoalLeaseProof = { goalId, ownerId: owner, fencingToken: forgedToken };
        await expect(executeGoalCommand(pool, transition, forgedProof)).rejects.toMatchObject({ code: "stale_lease" });
        await expect(counts(pool)).resolves.toEqual(before);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects every generated goalId/ownerId mismatch proof with zero durable writes", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryText, arbitraryText, async (wrongGoalSuffix, wrongOwnerSuffix) => {
        const goalId = randomUUID();
        const projectId = randomUUID();
        const owner = "real-owner";
        const current = await acquireGoalLease(pool, { goalId, ownerId: owner, leaseDurationMs: 60_000 });
        const wrongGoalId = `${goalId.slice(0, -8)}${wrongGoalSuffix.padEnd(8, "0").slice(0, 8)}`;
        fc.pre(wrongGoalId !== goalId);

        const before = await counts(pool);
        const command: GoalCommand = {
          commandId: randomUUID(), projectId, goalId, actorId: "operator",
          type: "CreateGoal", expectedVersion: 0,
        };
        const wrongGoalProof: GoalLeaseProof = { goalId: wrongGoalId, ownerId: owner, fencingToken: current.fencingToken };
        await expect(executeGoalCommand(pool, command, wrongGoalProof)).rejects.toMatchObject({ code: "stale_lease" });

        const wrongOwnerProof: GoalLeaseProof = { goalId, ownerId: `not-${wrongOwnerSuffix}`, fencingToken: current.fencingToken };
        await expect(executeGoalCommand(pool, command, wrongOwnerProof)).rejects.toMatchObject({ code: "stale_lease" });

        await expect(counts(pool)).resolves.toEqual(before);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects every generated forged-token renew attempt without extending expiry or changing the token", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryForgedFencingToken, arbitraryText, async (forgedToken, ownerSuffix) => {
        const goalId = randomUUID();
        const owner = `owner-${ownerSuffix}`;
        const current = await acquireGoalLease(pool, { goalId, ownerId: owner, leaseDurationMs: 60_000 });
        fc.pre(forgedToken !== current.fencingToken);

        const before = await pool.query<{ fencing_token: string; expires_at: Date }>(
          "SELECT fencing_token, expires_at FROM goal_leases WHERE goal_id = $1",
          [goalId],
        );
        const forgedProof: GoalLeaseProof = { goalId, ownerId: owner, fencingToken: forgedToken };
        await expect(renewGoalLease(pool, forgedProof, 60_000)).rejects.toMatchObject({ code: "stale_lease" });

        const after = await pool.query<{ fencing_token: string; expires_at: Date }>(
          "SELECT fencing_token, expires_at FROM goal_leases WHERE goal_id = $1",
          [goalId],
        );
        expect(after.rows[0]).toEqual(before.rows[0]);
      }),
      { numRuns: 25 },
    );
  });
});
