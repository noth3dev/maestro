import { WorkerNotFoundError } from "./types.js";
import { WorkerRow, mapWorker, workerSelectSql } from "./shared.js";
import { type Worker } from "@maestro/domain";
import type { Pool } from "pg";

export async function readWorker(pool: Pool, workerId: string): Promise<Worker> {
  const result = await pool.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1", [workerId]);
  if (result.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
  return mapWorker(result.rows[0]!);
}

export async function readWorkerBySpawnCommand(pool: Pool, commandId: string): Promise<Worker | undefined> {
  const result = await pool.query<WorkerRow>(workerSelectSql() + " WHERE spawn_command_id = $1", [commandId]);
  return result.rowCount === 1 ? mapWorker(result.rows[0]!) : undefined;
}

export async function listWorkersForMission(
  pool: Pool,
  councilId: string,
  departmentId: string,
  planVersion: number,
  itemId: string,
): Promise<readonly Worker[]> {
  const result = await pool.query<WorkerRow>(
    workerSelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 ORDER BY attempt",
    [councilId, departmentId, planVersion, itemId],
  );
  return result.rows.map(mapWorker);
}
