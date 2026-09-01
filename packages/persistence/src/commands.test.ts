import { describe, expect, it, vi } from "vitest";
import {
  StaleGoalLeaseError,
  executeGoalCommand,
  renewGoalLease,
  type GoalLeaseProof,
} from "./commands.js";

const proof = (fencingToken: string): GoalLeaseProof => ({
  goalId: "goal-1",
  ownerId: "actor-1",
  fencingToken,
});

describe("lease fencing token bounds", () => {
  it("accepts the PostgreSQL signed bigint maximum as a structurally valid token", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ goal_id: "goal-1", owner_id: "actor-1", fencing_token: "9223372036854775807" }],
    });
    const validProof = proof("9223372036854775807");

    await expect(renewGoalLease({ query } as never, validProof, 1_000)).resolves.toEqual(validProof);
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(["9223372036854775808", "1".repeat(100)])(
    "rejects out-of-range token %s before a renewal query",
    async (fencingToken) => {
      const query = vi.fn();

      await expect(renewGoalLease({ query } as never, proof(fencingToken), 1_000))
        .rejects.toBeInstanceOf(StaleGoalLeaseError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each(["9223372036854775808", "1".repeat(100)])(
    "rejects out-of-range token %s before a command database query",
    async (fencingToken) => {
      const connect = vi.fn();
      const command = {
        commandId: "command-1",
        projectId: "project-1",
        goalId: "goal-1",
        actorId: "actor-1",
        type: "CreateGoal" as const,
        expectedVersion: 0,
      };

      await expect(executeGoalCommand({ connect } as never, command, proof(fencingToken)))
        .rejects.toBeInstanceOf(StaleGoalLeaseError);
      expect(connect).not.toHaveBeenCalled();
    },
  );
});


describe("command lease ownership", () => {
  it("executes an operator-audited command using the current control-plane lease", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM goal_leases")) return { rowCount: 1, rows: [{ goal_id: "goal-1" }] };
      if (text.includes("FROM command_receipts")) return { rowCount: 0, rows: [] };
      if (text.includes("FROM goals")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const command = {
      commandId: "command-1",
      projectId: "project-1",
      goalId: "goal-1",
      actorId: "operator-B",
      type: "CreateGoal" as const,
      expectedVersion: 0,
    };

    await expect(executeGoalCommand(
      { connect } as never,
      command,
      { goalId: command.goalId, ownerId: "instance-A", fencingToken: "1" },
    )).resolves.toMatchObject({ outcome: "succeeded", goalId: command.goalId });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("owner_id = $2"), [
      command.goalId, "instance-A", "1",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
