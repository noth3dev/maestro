import type { Pool } from "pg";
import type { HeadBriefOutcome, HeadBriefRuntime } from "./head-brief-runtime.js";

export interface HeadBriefScheduler {
  /** Run the Heads' brief stage for a Council in the background (once per Goal at a time). */
  schedule(input: { readonly goalId: string; readonly councilId: string }): void;
  /** Resolves when no brief stage is running (tests and shutdown). */
  idle(): Promise<void>;
}

/**
 * Heads answer in the background so starting a Goal never waits on models.
 * Heads that failed (bad JSON, provider error) are asked again after each
 * delay; Heads that already settled are never asked twice.
 */
export function createHeadBriefScheduler(options: {
  readonly runtime: HeadBriefRuntime;
  readonly retryDelaysMs?: readonly number[];
  readonly onOutcome?: (input: { readonly goalId: string; readonly councilId: string; readonly outcomes: readonly HeadBriefOutcome[]; readonly revealed: boolean }) => void;
  readonly onError?: (error: unknown) => void;
}): HeadBriefScheduler {
  const retryDelaysMs = options.retryDelaysMs ?? [30_000, 120_000];
  const running = new Map<string, Promise<void>>();

  async function stage(goalId: string, councilId: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await options.runtime.run({ goalId, councilId });
      options.onOutcome?.({ goalId, councilId, ...result });
      const failed = result.outcomes.some((outcome) => outcome.outcome === "failed");
      if (result.revealed || !failed || attempt >= retryDelaysMs.length) return;
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }

  return {
    schedule({ goalId, councilId }) {
      if (running.has(goalId)) return;
      const task = stage(goalId, councilId)
        .catch((error: unknown) => options.onError?.(error))
        .finally(() => running.delete(goalId));
      running.set(goalId, task);
    },
    async idle() {
      while (running.size > 0) await Promise.all(running.values());
    },
  };
}

/** Councils still planning (collecting briefs, meeting, or a draft awaiting Encore); resumed after a restart. */
export async function listCouncilsAwaitingBriefs(pool: Pool): Promise<readonly { goalId: string; councilId: string }[]> {
  const rows = await pool.query<{ goal_id: string; council_id: string }>(
    `SELECT r.goal_id, c.council_id
       FROM goal_orchestration_runs r
       JOIN goals g ON g.goal_id = r.goal_id
       JOIN head_councils c ON c.goal_id = r.goal_id AND c.contract_id = g.task_contract_id
      WHERE r.stage = 'briefs_pending' AND r.state = 'running'
        AND (c.state = 'collecting'
             OR (c.state = 'revealed' AND NOT EXISTS (SELECT 1 FROM goal_plans p WHERE p.council_id = c.council_id))
             OR EXISTS (SELECT 1 FROM goal_plans p WHERE p.council_id = c.council_id AND p.status = 'draft'))`,
  );
  return rows.rows.map((row) => ({ goalId: row.goal_id, councilId: row.council_id }));
}

/** The planning Council of the Goal an Overture run launched (to resume its meeting). */
export async function listCouncilsForRun(pool: Pool, runId: string): Promise<readonly { goalId: string; councilId: string }[]> {
  const rows = await pool.query<{ goal_id: string; council_id: string }>(
    `SELECT g.goal_id, c.council_id
       FROM overture_runs r
       JOIN goals g ON g.task_contract_id = r.task_contract_id
       JOIN head_councils c ON c.goal_id = g.goal_id AND c.contract_id = g.task_contract_id
      WHERE r.run_id = $1 AND c.state = 'revealed'`,
    [runId],
  );
  return rows.rows.map((row) => ({ goalId: row.goal_id, councilId: row.council_id }));
}
