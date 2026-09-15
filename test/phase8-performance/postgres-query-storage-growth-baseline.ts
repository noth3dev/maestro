import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type { GoalEvent, GoalState } from "@maestro/contracts";
import { acquireGoalLease, executeGoalCommand, listGoalEvents, releaseGoalLease, type GoalCommand, type GoalLeaseProof } from "@maestro/persistence";
import type { Pool } from "pg";

type Distribution = { readonly p50: number; readonly p95: number; readonly max: number };
type StorageTable = "command_receipts" | "goal_events" | "outbox" | "goals" | "goal_controls" | "goal_leases";
type RelationSnapshot = { readonly rows: number; readonly heapBytes: number; readonly indexBytes: number; readonly totalBytes: number };
type RelationGrowth = RelationSnapshot & { readonly beforeRows: number; readonly rowDelta: number; readonly heapBytesDelta: number; readonly indexBytesDelta: number; readonly totalBytesDelta: number };

export interface PostgresQueryStorageGrowthBaseline {
  readonly metric: "postgres-query-storage-growth";
  readonly database: "postgresql";
  readonly sampleCount: number;
  readonly goals: number;
  readonly commandsGenerated: number;
  readonly eventsGenerated: number;
  readonly measurementWindowMs: number;
  readonly replayQueryMs: Distribution;
  readonly replayPages: Distribution;
  readonly storage: { readonly totalBytesBefore: number; readonly totalBytesAfter: number; readonly totalBytesDelta: number; readonly bytesPerCommand: number; readonly bytesPerEvent: number; readonly tables: Record<StorageTable, RelationGrowth> };
  readonly invariants: { readonly projectScopePreserved: boolean; readonly cursorsStrictlyIncreasing: boolean; readonly finalGoalVersionsCorrect: boolean };
}

const GOAL_COUNT = 10;
const ROUND_COUNT = 10;
const LEASE_DURATION_MS = 60_000;
const TABLES: readonly StorageTable[] = ["command_receipts", "goal_events", "outbox", "goals", "goal_controls", "goal_leases"];
const ROUND_TRANSITIONS: readonly GoalState[] = ["pausing", "paused", "resuming", "active"];

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)]!,
    max: Math.max(...sorted),
  };
}

async function relationSnapshot(pool: Pool, table: StorageTable): Promise<RelationSnapshot> {
  const result = await pool.query<{ rows: string; heap_bytes: string; index_bytes: string; total_bytes: string }>(
    `SELECT (SELECT COUNT(*)::bigint::text FROM ${table}) AS rows,
            pg_table_size($1::regclass)::bigint::text AS heap_bytes,
            pg_indexes_size($1::regclass)::bigint::text AS index_bytes,
            pg_total_relation_size($1::regclass)::bigint::text AS total_bytes`,
    [table],
  );
  const row = result.rows[0]!;
  return { rows: Number(row.rows), heapBytes: Number(row.heap_bytes), indexBytes: Number(row.index_bytes), totalBytes: Number(row.total_bytes) };
}

async function allRelationSnapshots(pool: Pool): Promise<Record<StorageTable, RelationSnapshot>> {
  const snapshots = {} as Record<StorageTable, RelationSnapshot>;
  for (const table of TABLES) snapshots[table] = await relationSnapshot(pool, table);
  return snapshots;
}

async function replayAll(pool: Pool, projectId: string): Promise<{ readonly events: GoalEvent[]; readonly pages: number }> {
  const events: GoalEvent[] = [];
  let cursor = "0";
  let pages = 0;
  while (true) {
    const page = await listGoalEvents(pool, { projectId, after: cursor });
    pages += 1;
    events.push(...page);
    if (page.length < 100) return { events, pages };
    cursor = page[page.length - 1]!.cursor;
  }
}

function assertCommandSucceeded(result: { readonly outcome: string; readonly version?: number }, goalId: string): number {
  if (result.outcome !== "succeeded" || result.version === undefined) throw new Error(`Expected durable command success for ${goalId}`);
  return result.version;
}

async function transition(pool: Pool, proof: GoalLeaseProof, projectId: string, goalId: string, actorId: string, expectedVersion: number, to: GoalState): Promise<number> {
  const command: GoalCommand = { commandId: randomUUID(), projectId, goalId, actorId, type: "TransitionGoal", expectedVersion, to };
  return assertCommandSucceeded(await executeGoalCommand(pool, command, proof), goalId);
}

function verifyReplay(events: readonly GoalEvent[], projectId: string, goalIds: ReadonlySet<string>, expectedCount: number, expectedVersion: number): { readonly projectScopePreserved: boolean; readonly cursorsStrictlyIncreasing: boolean; readonly finalGoalVersionsCorrect: boolean } {
  let projectScopePreserved = events.length === expectedCount;
  let cursorsStrictlyIncreasing = true;
  let previousCursor = 0n;
  const latestVersions = new Map<string, string>();
  for (const event of events) {
    projectScopePreserved &&= event.projectId === projectId && goalIds.has(event.goalId);
    const cursor = BigInt(event.cursor);
    cursorsStrictlyIncreasing &&= cursor > previousCursor;
    previousCursor = cursor;
    latestVersions.set(event.goalId, event.aggregateVersion);
  }
  const finalGoalVersionsCorrect = latestVersions.size === goalIds.size && [...goalIds].every((goalId) => latestVersions.get(goalId) === String(expectedVersion));
  return { projectScopePreserved, cursorsStrictlyIncreasing, finalGoalVersionsCorrect };
}

export async function measurePostgresQueryStorageGrowth(pool: Pool, projectId: string): Promise<PostgresQueryStorageGrowthBaseline> {
  const before = await allRelationSnapshots(pool);
  const goalIds = [...Array(GOAL_COUNT)].map(() => randomUUID());
  const proofs: GoalLeaseProof[] = [];
  const replayTimes: number[] = [];
  const replayPageCounts: number[] = [];
  const versions = new Map<string, number>();
  let eventsGenerated = 0;
  let invariants = { projectScopePreserved: true, cursorsStrictlyIncreasing: true, finalGoalVersionsCorrect: true };
  const measurementStarted = performance.now();

  try {
    for (const [index, goalId] of goalIds.entries()) {
      const ownerId = `postgres-storage-${index}`;
      const proof = await acquireGoalLease(pool, { goalId, ownerId, leaseDurationMs: LEASE_DURATION_MS });
      proofs.push(proof);
      let version = assertCommandSucceeded(await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "storage-baseline", type: "CreateGoal", expectedVersion: 0 }, proof), goalId);
      eventsGenerated += 1;
      for (const to of ["ready_for_confirmation", "launched", "active"] as const) {
        version = await transition(pool, proof, projectId, goalId, "storage-baseline", version, to);
          eventsGenerated += 1;
      }
      versions.set(goalId, version);
    }

    for (let round = 0; round < ROUND_COUNT; round += 1) {
      for (const proof of proofs) {
        let version = versions.get(proof.goalId)!;
        for (const to of ROUND_TRANSITIONS) {
          version = await transition(pool, proof, projectId, proof.goalId, "storage-baseline", version, to);
              eventsGenerated += 1;
        }
        versions.set(proof.goalId, version);
      }
      const queryStarted = performance.now();
      const replay = await replayAll(pool, projectId);
      replayTimes.push(performance.now() - queryStarted);
      replayPageCounts.push(replay.pages);
      const currentInvariants = verifyReplay(replay.events, projectId, new Set(goalIds), eventsGenerated, 4 + (round + 1) * ROUND_TRANSITIONS.length);
      invariants = {
        projectScopePreserved: invariants.projectScopePreserved && currentInvariants.projectScopePreserved,
        cursorsStrictlyIncreasing: invariants.cursorsStrictlyIncreasing && currentInvariants.cursorsStrictlyIncreasing,
        finalGoalVersionsCorrect: invariants.finalGoalVersionsCorrect && currentInvariants.finalGoalVersionsCorrect,
      };
    }
  } finally {
    for (const proof of proofs) {
      try { await releaseGoalLease(pool, proof); } catch { /* preserve the original measurement failure */ }
    }
  }

  const after = await allRelationSnapshots(pool);
  const tables = {} as Record<StorageTable, RelationGrowth>;
  let totalBytesBefore = 0;
  let totalBytesAfter = 0;
  for (const table of TABLES) {
    const initial = before[table]!;
    const final = after[table]!;
    totalBytesBefore += initial.totalBytes;
    totalBytesAfter += final.totalBytes;
    tables[table] = {
      ...final,
      beforeRows: initial.rows,
      rowDelta: final.rows - initial.rows,
      heapBytesDelta: final.heapBytes - initial.heapBytes,
      indexBytesDelta: final.indexBytes - initial.indexBytes,
      totalBytesDelta: final.totalBytes - initial.totalBytes,
    };
  }
  const totalBytesDelta = totalBytesAfter - totalBytesBefore;
  const observedCommands = tables.command_receipts!.rowDelta;
  const observedEvents = tables.goal_events!.rowDelta;
  const observedGoals = tables.goals!.rowDelta;
  return {
    metric: "postgres-query-storage-growth",
    database: "postgresql",
    sampleCount: replayTimes.length,
    goals: observedGoals,
    commandsGenerated: observedCommands,
    eventsGenerated: observedEvents,
    measurementWindowMs: performance.now() - measurementStarted,
    replayQueryMs: distribution(replayTimes),
    replayPages: distribution(replayPageCounts),
    storage: { totalBytesBefore, totalBytesAfter, totalBytesDelta, bytesPerCommand: totalBytesDelta / observedCommands, bytesPerEvent: totalBytesDelta / observedEvents, tables },
    invariants,
  };
}
