import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export const IPYTHON_SESSION_JOURNAL_EVENTS = [
  "started", "orphaned", "reaped", "completed", "failed", "cancelled", "unknown",
] as const;
export type IpPythonSessionJournalEvent = (typeof IPYTHON_SESSION_JOURNAL_EVENTS)[number];
export type IpPythonTerminalJournalEvent = "reaped" | "completed" | "failed" | "cancelled" | "unknown";

export interface IpPythonSessionJournalEntry {
  readonly journalId: string;
  readonly journalPosition: string;
  readonly sessionId: string;
  readonly processRef: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly event: IpPythonSessionJournalEvent;
  readonly reason: string | null;
  readonly processPid: number | null;
  readonly parentPid: number | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface AppendIpPythonSessionJournalInput {
  readonly sessionId: string;
  /** A unique process generation. It must change when a session is restarted. */
  readonly processRef: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly event: IpPythonSessionJournalEvent;
  readonly reason?: string;
  readonly processPid?: number;
  readonly parentPid?: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ReconcileIpPythonOrphansOptions {
  /**
   * Returns only a proven terminal process outcome. The default is unknown;
   * this API deliberately has no success/cancellation inference path.
   */
  readonly determineOutcome?: (
    orphan: IpPythonSessionJournalEntry,
  ) => IpPythonTerminalJournalEvent | Promise<IpPythonTerminalJournalEvent>;
}

export class IpPythonSessionJournalError extends Error {}
export class IpPythonSessionJournalConflictError extends IpPythonSessionJournalError {}

interface JournalRow {
  journal_id: string;
  journal_position: string;
  session_id: string;
  process_ref: string;
  project_id: string;
  goal_id: string;
  event: IpPythonSessionJournalEvent;
  reason: string | null;
  process_pid: number | null;
  parent_pid: number | null;
  details: Readonly<Record<string, unknown>>;
  occurred_at: Date;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new IpPythonSessionJournalError(`${name} is required`);
}

function validateInput(input: AppendIpPythonSessionJournalInput): void {
  assertNonEmpty(input.sessionId, "IPython session ID");
  assertNonEmpty(input.processRef, "IPython process reference");
  assertNonEmpty(input.projectId, "IPython project ID");
  assertNonEmpty(input.goalId, "IPython Goal ID");
  if (!IPYTHON_SESSION_JOURNAL_EVENTS.includes(input.event)) throw new IpPythonSessionJournalError("IPython journal event is invalid");
  if (input.event !== "started") assertNonEmpty(input.reason ?? "", "IPython journal reason");
  for (const [value, name] of [[input.processPid, "process PID"], [input.parentPid, "parent PID"]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new IpPythonSessionJournalError(`IPython ${name} is invalid`);
  }
  if (input.details !== undefined && (typeof input.details !== "object" || input.details === null || Array.isArray(input.details))) throw new IpPythonSessionJournalError("IPython journal details must be an object");
}

function map(row: JournalRow): IpPythonSessionJournalEntry {
  return {
    journalId: row.journal_id,
    journalPosition: String(row.journal_position),
    sessionId: row.session_id,
    processRef: row.process_ref,
    projectId: row.project_id,
    goalId: row.goal_id,
    event: row.event,
    reason: row.reason,
    processPid: row.process_pid,
    parentPid: row.parent_pid,
    details: row.details,
    occurredAt: row.occurred_at,
  };
}

const COLUMNS = "journal_id, journal_position, session_id, process_ref, project_id, goal_id, event, reason, process_pid, parent_pid, details, occurred_at";

function sameContent(row: IpPythonSessionJournalEntry, input: AppendIpPythonSessionJournalInput): boolean {
  return row.sessionId === input.sessionId &&
    row.processRef === input.processRef &&
    row.projectId === input.projectId &&
    row.goalId === input.goalId &&
    row.event === input.event &&
    row.reason === (input.reason ?? null) &&
    row.processPid === (input.processPid ?? null) &&
    row.parentPid === (input.parentPid ?? null) &&
    canonicalJson(row.details) === canonicalJson(input.details ?? {});
}

/** Append one immutable lifecycle event, returning the existing event on an identical retry. */
export async function appendIpPythonSessionJournal(
  pool: Pick<Pool, "query">,
  input: AppendIpPythonSessionJournalInput,
): Promise<IpPythonSessionJournalEntry> {
  validateInput(input);
  const inserted = await pool.query<JournalRow>(
    `INSERT INTO ipython_session_journal
      (journal_id, session_id, process_ref, project_id, goal_id, event, reason, process_pid, parent_pid, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING ${COLUMNS}`,
    [randomUUID(), input.sessionId, input.processRef, input.projectId, input.goalId, input.event, input.reason ?? null, input.processPid ?? null, input.parentPid ?? null, JSON.stringify(input.details ?? {})],
  );
  if (inserted.rowCount === 1) return map(inserted.rows[0]!);

  const existing = await pool.query<JournalRow>(
    `SELECT ${COLUMNS} FROM ipython_session_journal WHERE process_ref = $1 AND event = $2`,
    [input.processRef, input.event],
  );
  if (existing.rowCount === 1) {
    const row = map(existing.rows[0]!);
    if (sameContent(row, input)) return row;
    throw new IpPythonSessionJournalConflictError("IPython journal event identity was reused with different content");
  }
  throw new IpPythonSessionJournalConflictError("IPython process already has a different terminal journal event");
}

export async function listIpPythonSessionJournal(
  pool: Pick<Pool, "query">,
  sessionId: string,
): Promise<readonly IpPythonSessionJournalEntry[]> {
  assertNonEmpty(sessionId, "IPython session ID");
  const result = await pool.query<JournalRow>(
    `SELECT ${COLUMNS} FROM ipython_session_journal WHERE session_id = $1 ORDER BY journal_position`,
    [sessionId],
  );
  return result.rows.map(map);
}

/** Return all process generations whose latest event is orphaned and has no terminal decision. */
async function listUnresolvedOrphans(pool: Pick<Pool, "query">): Promise<readonly IpPythonSessionJournalEntry[]> {
  const result = await pool.query<JournalRow>(
    `SELECT journal_id, journal_position, session_id, process_ref, project_id, goal_id, event, reason, process_pid, parent_pid, details, occurred_at
       FROM (
         SELECT DISTINCT ON (process_ref) ${COLUMNS}
           FROM ipython_session_journal
          ORDER BY process_ref, journal_position DESC
       ) latest
      WHERE latest.event = 'orphaned'
      ORDER BY latest.journal_position`,
  );
  return result.rows.map(map);
}

/**
 * Reconcile every orphaned process generation exactly once. A missing
 * observation is intentionally recorded as unknown, never as success or
 * cancellation. Concurrent reconcilers are fenced by the terminal unique
 * index and safely converge through the idempotent append operation.
 */
export async function reconcileIpPythonOrphans(
  pool: Pick<Pool, "query">,
  options: ReconcileIpPythonOrphansOptions = {},
): Promise<readonly IpPythonSessionJournalEntry[]> {
  const determineOutcome = options.determineOutcome ?? (() => "unknown" as const);
  const reconciled: IpPythonSessionJournalEntry[] = [];
  for (const orphan of await listUnresolvedOrphans(pool)) {
    const outcome = await determineOutcome(orphan);
    if (!(outcome === "reaped" || outcome === "unknown")) throw new IpPythonSessionJournalError("IPython orphan reconciliation outcome must be reaped or unknown");
    const reason = outcome === "reaped"
      ? "IPython child process was proven absent and reaped"
      : "IPython child outcome is unknown; success and cancellation were not inferred";
    try {
      const terminal = await appendIpPythonSessionJournal(pool, {
        sessionId: orphan.sessionId,
        processRef: orphan.processRef,
        projectId: orphan.projectId,
        goalId: orphan.goalId,
        event: outcome,
        reason,
        ...(orphan.processPid === null ? {} : { processPid: orphan.processPid }),
        ...(orphan.parentPid === null ? {} : { parentPid: orphan.parentPid }),
        details: orphan.details,
      });
      reconciled.push(terminal);
    } catch (error) {
      // Another reconciler may have won the terminal race. Re-read the latest
      // state and leave it untouched; this pass did not create a duplicate.
      if (!(error instanceof IpPythonSessionJournalConflictError)) throw error;
    }
  }
  return reconciled;
}

export async function recordIpPythonSessionStarted(
  pool: Pick<Pool, "query">,
  input: Omit<AppendIpPythonSessionJournalInput, "event" | "reason">,
): Promise<IpPythonSessionJournalEntry> {
  return appendIpPythonSessionJournal(pool, { ...input, event: "started" });
}

export async function recordIpPythonSessionOrphaned(
  pool: Pick<Pool, "query">,
  input: Omit<AppendIpPythonSessionJournalInput, "event"> & { readonly reason: string },
): Promise<IpPythonSessionJournalEntry> {
  return appendIpPythonSessionJournal(pool, { ...input, event: "orphaned" });
}
