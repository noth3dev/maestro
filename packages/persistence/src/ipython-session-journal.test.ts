import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import {
  appendIpPythonSessionJournal,
  listIpPythonSessionJournal,
  reconcileIpPythonOrphans,
  type IpPythonSessionJournalEntry,
} from "./ipython-session-journal.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("IPython session journal", () => {
  const schema = `ipython_journal_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  const pool = new Pool({ connectionString: scopedUrl });
  const projectId = randomUUID();
  const goalId = randomUUID();

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool);
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'draft', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE ipython_session_journal");
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  function input(event: IpPythonSessionJournalEntry["event"], processRef = `process-${randomUUID()}`) {
    return {
      sessionId: `session-${randomUUID()}`,
      processRef,
      projectId,
      goalId,
      event,
      reason: event === "started" ? undefined : `${event}-reason`,
      processPid: 12345,
      parentPid: 12344,
    };
  }

  it("journals a parent-dead live session as orphaned and then reaped", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool, started);
    await appendIpPythonSessionJournal(pool, { ...started, event: "orphaned", reason: "parent_dead" });
    await appendIpPythonSessionJournal(pool, { ...started, event: "reaped", reason: "owned_process_group_reaped" });

    await expect(listIpPythonSessionJournal(pool, started.sessionId)).resolves.toMatchObject([
      { event: "started", processRef: started.processRef },
      { event: "orphaned", reason: "parent_dead" },
      { event: "reaped", reason: "owned_process_group_reaped" },
    ]);
  });

  it("reconciles an orphan exactly once when the child is proven absent", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool, started);
    await appendIpPythonSessionJournal(pool, { ...started, event: "orphaned", reason: "control_plane_restart" });

    const first = await reconcileIpPythonOrphans(pool, { determineOutcome: () => "reaped" });
    const second = await reconcileIpPythonOrphans(pool, { determineOutcome: () => "reaped" });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    const events = await listIpPythonSessionJournal(pool, started.sessionId);
    expect(events.filter((event) => event.event === "reaped")).toHaveLength(1);
  });

  it("records unknown when restart cannot prove the process outcome", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool, started);
    await appendIpPythonSessionJournal(pool, { ...started, event: "orphaned", reason: "child_outcome_unobserved" });

    await expect(reconcileIpPythonOrphans(pool)).resolves.toHaveLength(1);
    const events = await listIpPythonSessionJournal(pool, started.sessionId);
    expect(events.at(-1)).toMatchObject({ event: "unknown" });
    expect(events.some((event) => event.event === "completed" || event.event === "cancelled")).toBe(false);
  });

  it("rejects direct UPDATE and DELETE because the journal is append-only", async () => {
    const started = input("started");
    const row = await appendIpPythonSessionJournal(pool, started);

    await expect(pool.query("UPDATE ipython_session_journal SET reason = 'tampered' WHERE journal_id = $1", [row.journalId])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM ipython_session_journal WHERE journal_id = $1", [row.journalId])).rejects.toThrow(/append-only/);
    await expect(listIpPythonSessionJournal(pool, started.sessionId)).resolves.toHaveLength(1);
  });
});
