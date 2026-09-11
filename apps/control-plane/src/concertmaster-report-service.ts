import { createHash } from "node:crypto";
import { ConcertmasterFinalReportSchema, type ConcertmasterFinalReport } from "@maestro/contracts";
import { assertProjectRole, generateConcertmasterFinalReport, type GoalLeaseProof, type OperatorContext } from "@maestro/persistence";
import { canonicalJson } from "@maestro/domain";
import type { Pool } from "pg";

export class ConcertmasterReportProjectMismatchError extends Error {
  constructor() { super("Concertmaster report Goal/project mismatch"); this.name = "ConcertmasterReportProjectMismatchError"; }
}

export class ConcertmasterReportGoalNotFoundError extends Error {
  constructor(goalId: string) { super(`Concertmaster report Goal was not found: ${goalId}`); this.name = "ConcertmasterReportGoalNotFoundError"; }
}

export class ConcertmasterReportCommandReuseError extends Error {
  constructor(commandId: string) { super(`Concertmaster report command ID was reused with different content: ${commandId}`); this.name = "ConcertmasterReportCommandReuseError"; }
}

export interface ConcertmasterReportService {
  generate(goalId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<ConcertmasterFinalReport>;
}

export interface ConcertmasterReportServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: GoalLeaseProof) => Promise<T>) => Promise<T>;
}

type ReportCommand = {
  commandId: string;
  projectId: string;
  goalId: string;
  actorId: string;
  type: "GenerateConcertmasterReport";
};

function commandHash(command: ReportCommand): Buffer {
  return createHash("sha256").update(canonicalJson(command)).digest();
}

/** Generates the immutable report only through an authenticated, Goal-leased command. */
export function createConcertmasterReportService(deps: ConcertmasterReportServiceDependencies): ConcertmasterReportService {
  return {
    async generate(goalId, projectId, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, projectId, "concertmaster");
      const command: ReportCommand = { commandId, projectId, goalId, actorId: operator.operatorId, type: "GenerateConcertmasterReport" };
      const hash = commandHash(command);
      const client = await deps.pool.connect();
      let open = false;
      try {
        await client.query("BEGIN");
        open = true;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 3))", [commandId]);
        const prior = await client.query<{ request_hash: Buffer; request: ReportCommand; result: ConcertmasterFinalReport }>(
          "SELECT request_hash, request, result FROM command_receipts WHERE command_id = $1",
          [commandId],
        );
        if (prior.rowCount === 1) {
          const row = prior.rows[0]!;
          if (!Buffer.from(row.request_hash).equals(hash) || canonicalJson(row.request) !== canonicalJson(command)) {
            throw new ConcertmasterReportCommandReuseError(commandId);
          }
          const replay = ConcertmasterFinalReportSchema.parse(row.result);
          await client.query("COMMIT");
          open = false;
          return replay;
        }

        const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [goalId]);
        if (goal.rowCount !== 1) throw new ConcertmasterReportGoalNotFoundError(goalId);
        if (goal.rows[0]!.project_id !== projectId) throw new ConcertmasterReportProjectMismatchError();

        // The report generator uses its own Goal lease transaction. The
        // command lock remains held so same-command retries cannot race it.
        const report = await deps.withGoalLease(goalId, (proof) => generateConcertmasterFinalReport(deps.pool, goalId, proof));
        const parsed = ConcertmasterFinalReportSchema.parse(report);
        await client.query(
          `INSERT INTO command_receipts
           (command_id, project_id, goal_id, actor_id, command_type, expected_version, request_hash, request, outcome, result)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7::jsonb, 'succeeded', $8::jsonb)`,
          [commandId, projectId, goalId, operator.operatorId, command.type, hash, JSON.stringify(command), JSON.stringify(parsed)],
        );
        await client.query("COMMIT");
        open = false;
        return parsed;
      } catch (error) {
        if (open) await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
