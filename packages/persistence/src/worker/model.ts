import { WorkerError } from "./types.js";
import { withWorkerLease } from "./shared.js";
import type { Pool } from "pg";
import { type GoalLeaseProof } from "../commands.js";
import { readMissionBundle } from "../mission-bundle.js";

export function selectWorkerModel(bundle: Awaited<ReturnType<typeof readMissionBundle>>, requested: string | undefined): string {
  const model = requested ?? (bundle.substance.approvedModels.length === 1 ? bundle.substance.approvedModels[0] : undefined);
  if (model === undefined) throw new WorkerError("Worker model selection is ambiguous; choose one approved model");
  if (!bundle.substance.approvedModels.includes(model))
    throw new WorkerError(`Worker model is not approved by the Mission Bundle: ${model}`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(model)) throw new WorkerError(`Worker model must use provider/model-id format: ${model}`);
  return model;
}

export function missionTimeLimitMs(value: string): number {
  const match = /^(\d+)\s+(millisecond|second|minute|hour|day)s?$/.exec(value.trim().toLowerCase());
  if (match === null) throw new WorkerError(`Mission Bundle timeCeiling is unsupported: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "millisecond" ? 1 : unit === "second" ? 1_000 : unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result <= 0) throw new WorkerError(`Mission Bundle timeCeiling is outside native limits: ${value}`);
  return result;
}

export async function assertCurrentWorkerLease(pool: Pool, workerId: string, proof: GoalLeaseProof): Promise<void> {
  await withWorkerLease(pool, workerId, proof, async () => undefined);
}
