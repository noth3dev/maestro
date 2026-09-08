import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  const basePool = databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl });
  const scopedUrl = databaseUrl === undefined ? undefined : (() => {
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  const pool = scopedUrl === undefined ? undefined : new Pool({ connectionString: scopedUrl });
  const projectId = randomUUID();
  const goalId = randomUUID();
  const otherProjectId = randomUUID();
  const otherGoalId = randomUUID();

  beforeAll(async () => {
    await basePool!.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool!);
    await pool!.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'draft', 1, transaction_timestamp(), transaction_timestamp()), ($3, $4, 'draft', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId, otherGoalId, otherProjectId],
    );
  });

  afterAll(async () => {
    await pool!.end();
    await basePool!.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool!.end();
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
    await appendIpPythonSessionJournal(pool!, started);
    await appendIpPythonSessionJournal(pool!, { ...started, event: "orphaned", reason: "parent_dead" });
    await appendIpPythonSessionJournal(pool!, { ...started, event: "reaped", reason: "owned_process_group_reaped" });

    await expect(listIpPythonSessionJournal(pool!, started.sessionId)).resolves.toMatchObject([
      { event: "started", processRef: started.processRef },
      { event: "orphaned", reason: "parent_dead" },
      { event: "reaped", reason: "owned_process_group_reaped" },
    ]);
  });

  it("reconciles an orphan exactly once when the child is proven absent", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);
    await appendIpPythonSessionJournal(pool!, { ...started, event: "orphaned", reason: "control_plane_restart" });

    const first = await reconcileIpPythonOrphans(pool!, { determineOutcome: () => "reaped" });
    const second = await reconcileIpPythonOrphans(pool!, { determineOutcome: () => "reaped" });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    const events = await listIpPythonSessionJournal(pool!, started.sessionId);
    expect(events.filter((event) => event.event === "reaped")).toHaveLength(1);
  });

  it("treats a started process with no terminal record as an orphan on restart", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);

    await expect(reconcileIpPythonOrphans(pool!, { determineOutcome: () => "reaped" })).resolves.toHaveLength(1);
    const events = await listIpPythonSessionJournal(pool!, started.sessionId);
    expect(events.map((event) => event.event)).toEqual(["started", "orphaned", "reaped"]);
  });

  it("records unknown when restart cannot prove the process outcome", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);
    await appendIpPythonSessionJournal(pool!, { ...started, event: "orphaned", reason: "child_outcome_unobserved" });

    await expect(reconcileIpPythonOrphans(pool!)).resolves.toHaveLength(1);
    const events = await listIpPythonSessionJournal(pool!, started.sessionId);
    expect(events.at(-1)).toMatchObject({ event: "unknown" });
    expect(events.some((event) => event.event === "completed" || event.event === "cancelled")).toBe(false);
  });

  it("converges duplicate and concurrent lifecycle appends", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);
    const orphaned = { ...started, event: "orphaned" as const, reason: "parent_dead" };
    await appendIpPythonSessionJournal(pool!, orphaned);
    await expect(appendIpPythonSessionJournal(pool!, orphaned)).resolves.toMatchObject({ event: "orphaned" });

    const terminal = { ...started, event: "unknown" as const, reason: "outcome_unproven" };
    const results = await Promise.all([
      appendIpPythonSessionJournal(pool!, terminal),
      appendIpPythonSessionJournal(pool!, terminal),
    ]);
    expect(results).toHaveLength(2);
    await expect(appendIpPythonSessionJournal(pool!, terminal)).resolves.toMatchObject({ event: "unknown" });
    const events = await listIpPythonSessionJournal(pool!, started.sessionId);
    expect(events.map((event) => event.event)).toEqual(["started", "orphaned", "unknown"]);
  });

  it("rejects cross-Goal identity reuse for one process generation", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);

    await expect(appendIpPythonSessionJournal(pool!, {
      ...started,
      projectId: otherProjectId,
      goalId: otherGoalId,
      event: "orphaned",
      reason: "parent_dead",
    })).rejects.toThrow(/identity|binding|scope/);
  });

  it("rejects terminal events before orphan evidence and events after a terminal", async () => {
    const terminalBeforeStart = input("reaped");
    await expect(appendIpPythonSessionJournal(pool!, terminalBeforeStart)).rejects.toThrow(/started|lifecycle/);

    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);
    await appendIpPythonSessionJournal(pool!, { ...started, event: "orphaned", reason: "parent_dead" });
    await appendIpPythonSessionJournal(pool!, { ...started, event: "reaped", reason: "group_reaped" });
    await expect(appendIpPythonSessionJournal(pool!, { ...started, event: "unknown", reason: "late_observation" })).rejects.toThrow(/terminal|lifecycle/);
  });

  it("rejects process identity changes within one generation", async () => {
    const started = input("started");
    await appendIpPythonSessionJournal(pool!, started);

    await expect(appendIpPythonSessionJournal(pool!, {
      ...started,
      event: "orphaned",
      reason: "parent_dead",
      processPid: started.processPid + 1,
    })).rejects.toThrow(/identity|binding|PID/);
  });

  it("rejects direct UPDATE and DELETE because the journal is append-only", async () => {
    const started = input("started");
    const row = await appendIpPythonSessionJournal(pool!, started);

    await expect(pool!.query("UPDATE ipython_session_journal SET reason = 'tampered' WHERE journal_id = $1", [row.journalId])).rejects.toThrow(/append-only/);
    await expect(pool!.query("DELETE FROM ipython_session_journal WHERE journal_id = $1", [row.journalId])).rejects.toThrow(/append-only/);
    await expect(pool!.query("TRUNCATE ipython_session_journal")).rejects.toThrow(/append-only/);
    await expect(pool!.query("TRUNCATE goals CASCADE")).resolves.toBeDefined();
    await expect(listIpPythonSessionJournal(pool!, started.sessionId)).resolves.toHaveLength(1);
    const reconciled = await reconcileIpPythonOrphans(pool!);
    expect(reconciled.some((entry) => entry.processRef === started.processRef && entry.event === "unknown")).toBe(true);
    await expect(listIpPythonSessionJournal(pool!, started.sessionId)).resolves.toMatchObject([
      { event: "started" },
      { event: "orphaned" },
      { event: "unknown" },
    ]);
  });
});
