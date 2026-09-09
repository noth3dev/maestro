import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type CapabilityTier = "automatic progress" | "Department Head" | "Encore Council" | "user";
export type CapabilityDecision = "approved" | "rejected" | "safer_alternative";
export type CapabilityJournalEvent = "approval" | "rejection" | "safer_alternative" | "interruption" | "effect_result" | "failure";
export type FullAccessMode = "retain_intermediate_approvals" | "skip_intermediate_approvals";

export type RepetitionScope =
  | { readonly kind: "one_execution" }
  | { readonly kind: "bounded_count"; readonly count: number }
  | { readonly kind: "bounded_time"; readonly expiresAt: Date }
  | { readonly kind: "bounded_budget"; readonly budgetCents: number }
  | { readonly kind: "session" };

export interface CapabilityApprovalInput {
  readonly approvalId: string;
  readonly capabilityKind: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly commandId: string;
  readonly action: string;
  readonly target: string;
  readonly policyVersion: number;
  readonly controlEpoch: string;
  readonly budgetEffectCents: number;
  readonly tier: CapabilityTier;
  readonly approverId: string;
  readonly decision: CapabilityDecision;
  readonly saferAlternative?: string;
  readonly expiresAt: Date;
  readonly repetitionScope: RepetitionScope;
}

export interface CapabilityApproval extends Omit<CapabilityApprovalInput, "repetitionScope"> {
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  readonly repetitionScope: RepetitionScope;
}

export interface CapabilitySessionInput {
  readonly sessionId: string;
  readonly capabilityKind: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly fullAccessMode: FullAccessMode;
  readonly selectedBy: string;
}

export interface CapabilitySession extends CapabilitySessionInput {
  readonly selectedAt: Date;
}

export interface CapabilityJournalInput {
  readonly capabilityKind: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly approvalId?: string;
  readonly commandId?: string;
  readonly event: CapabilityJournalEvent;
  readonly details: Record<string, unknown>;
}

export interface CapabilityJournalEntry extends CapabilityJournalInput {
  readonly journalId: string;
  readonly recordedAt: Date;
}

export interface CapabilityConsumptionInput {
  readonly approvalId: string;
  readonly capabilityKind: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly commandId: string;
  readonly action: string;
  readonly target: string;
  readonly policyVersion: number;
  readonly controlEpoch: string;
  readonly budgetEffectCents: number;
}

export interface CapabilityConsumptionResult {
  readonly consumed: boolean;
  readonly remainingCount: number | null;
  readonly remainingBudgetCents: number | null;
}

export class CapabilityApprovalError extends Error {
  constructor(message: string) { super(message); this.name = "CapabilityApprovalError"; }
}
export class CapabilityApprovalConflictError extends CapabilityApprovalError {}
export class CapabilityApprovalScopeError extends CapabilityApprovalError {}
export class CapabilityApprovalExpiredError extends CapabilityApprovalError {}
export class CapabilityApprovalRevokedError extends CapabilityApprovalError {}
export class CapabilityApprovalRejectedError extends CapabilityApprovalError {}
export class RepetitionBudgetExhaustedError extends CapabilityApprovalError {}

interface ApprovalRow {
  approval_id: string; capability_kind: string; project_id: string; goal_id: string; command_id: string;
  action: string; target: string; policy_version: number; control_epoch: string; budget_effect_cents: string;
  tier: CapabilityTier; approver_id: string; decision: CapabilityDecision; expires_at: Date; revoked_at: Date | null; created_at: Date;
}
interface BudgetRow {
  approval_id: string; scope_kind: RepetitionScope["kind"]; remaining_count: string | null;
  remaining_budget_cents: string | null; expires_at: Date | null;
}
interface SessionRow { session_id: string; capability_kind: string; project_id: string; goal_id: string; full_access_mode: FullAccessMode; selected_by: string; selected_at: Date; }
interface JournalRow { journal_id: string; capability_kind: string; project_id: string; goal_id: string; approval_id: string | null; command_id: string | null; event: CapabilityJournalEvent; details: Record<string, unknown>; recorded_at: Date; }

type QueryExecutor = Pick<Pool | PoolClient, "query">;

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new CapabilityApprovalError(`${label} must be non-empty`);
}
function requireDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new CapabilityApprovalError(`${label} must be a valid date`);
}
function scopeValues(scope: RepetitionScope): { kind: RepetitionScope["kind"]; count: number | null; budgetCents: number | null; expiresAt: Date | null } {
  if (scope.kind === "one_execution") return { kind: scope.kind, count: 1, budgetCents: null, expiresAt: null };
  if (scope.kind === "bounded_count") {
    if (!Number.isSafeInteger(scope.count) || scope.count <= 0) throw new CapabilityApprovalError("bounded_count must be a positive safe integer");
    return { kind: scope.kind, count: scope.count, budgetCents: null, expiresAt: null };
  }
  if (scope.kind === "bounded_time") { requireDate(scope.expiresAt, "repetition expiry"); return { kind: scope.kind, count: null, budgetCents: null, expiresAt: scope.expiresAt }; }
  if (scope.kind === "bounded_budget") {
    if (!Number.isSafeInteger(scope.budgetCents) || scope.budgetCents <= 0) throw new CapabilityApprovalError("bounded_budget must be a positive safe integer");
    return { kind: scope.kind, count: null, budgetCents: scope.budgetCents, expiresAt: null };
  }
  return { kind: scope.kind, count: null, budgetCents: null, expiresAt: null };
}
function mapBudget(row: BudgetRow): RepetitionScope {
  if (row.scope_kind === "one_execution") return { kind: "one_execution" };
  if (row.scope_kind === "bounded_count") return { kind: "bounded_count", count: Number(row.remaining_count) };
  if (row.scope_kind === "bounded_time") return { kind: "bounded_time", expiresAt: row.expires_at! };
  if (row.scope_kind === "bounded_budget") return { kind: "bounded_budget", budgetCents: Number(row.remaining_budget_cents) };
  return { kind: "session" };
}
function mapApproval(row: ApprovalRow, budget: BudgetRow): CapabilityApproval {
  return { approvalId: row.approval_id, capabilityKind: row.capability_kind, projectId: row.project_id, goalId: row.goal_id, commandId: row.command_id, action: row.action, target: row.target, policyVersion: row.policy_version, controlEpoch: row.control_epoch, budgetEffectCents: Number(row.budget_effect_cents), tier: row.tier, approverId: row.approver_id, decision: row.decision, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at, repetitionScope: mapBudget(budget) };
}
function mapSession(row: SessionRow): CapabilitySession { return { sessionId: row.session_id, capabilityKind: row.capability_kind, projectId: row.project_id, goalId: row.goal_id, fullAccessMode: row.full_access_mode, selectedBy: row.selected_by, selectedAt: row.selected_at }; }
function mapJournal(row: JournalRow): CapabilityJournalEntry {
  const entry: CapabilityJournalEntry = {
    journalId: row.journal_id, capabilityKind: row.capability_kind, projectId: row.project_id, goalId: row.goal_id,
    event: row.event, details: row.details, recordedAt: row.recorded_at,
  };
  if (row.approval_id !== null) (entry as { approvalId?: string }).approvalId = row.approval_id;
  if (row.command_id !== null) (entry as { commandId?: string }).commandId = row.command_id;
  return entry;
}
function assertApprovalInput(input: CapabilityApprovalInput): { scope: ReturnType<typeof scopeValues> } {
  for (const [value, label] of [[input.approvalId, "approvalId"], [input.capabilityKind, "capabilityKind"], [input.projectId, "projectId"], [input.goalId, "goalId"], [input.commandId, "commandId"], [input.action, "action"], [input.target, "target"], [input.controlEpoch, "controlEpoch"], [input.approverId, "approverId"]] as const) requireText(value, label);
  if (!Number.isSafeInteger(input.policyVersion) || input.policyVersion <= 0) throw new CapabilityApprovalError("policyVersion must be a positive safe integer");
  if (!Number.isSafeInteger(input.budgetEffectCents) || input.budgetEffectCents < 0) throw new CapabilityApprovalError("budgetEffectCents must be a non-negative safe integer");
  requireDate(input.expiresAt, "expiresAt");
  return { scope: scopeValues(input.repetitionScope) };
}

async function insertJournal(executor: QueryExecutor, input: CapabilityJournalInput): Promise<CapabilityJournalEntry> {
  const result = await executor.query<JournalRow>(
    `INSERT INTO capability_decision_journal (journal_id, capability_kind, project_id, goal_id, approval_id, command_id, event, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *`,
    [randomUUID(), input.capabilityKind, input.projectId, input.goalId, input.approvalId ?? null, input.commandId ?? null, input.event, JSON.stringify(input.details)],
  );
  return mapJournal(result.rows[0]!);
}

export async function appendCapabilityJournal(pool: QueryExecutor, input: CapabilityJournalInput): Promise<CapabilityJournalEntry> {
  for (const [value, label] of [[input.capabilityKind, "capabilityKind"], [input.projectId, "projectId"], [input.goalId, "goalId"]] as const) requireText(value, label);
  return insertJournal(pool, input);
}

function budgetMatchesScope(budget: BudgetRow, scope: ReturnType<typeof scopeValues>): boolean {
  return budget.scope_kind === scope.kind
    && (budget.remaining_count === null ? scope.count === null : Number(budget.remaining_count) === scope.count)
    && (budget.remaining_budget_cents === null ? scope.budgetCents === null : Number(budget.remaining_budget_cents) === scope.budgetCents)
    && (budget.expires_at?.getTime() ?? null) === (scope.expiresAt?.getTime() ?? null);
}

export async function createCapabilityApproval(pool: Pool, input: CapabilityApprovalInput): Promise<CapabilityApproval> {
  const { scope } = assertApprovalInput(input);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const inserted = await client.query<ApprovalRow>(
      `INSERT INTO capability_approvals (approval_id, capability_kind, project_id, goal_id, command_id, action, target, policy_version, control_epoch, budget_effect_cents, tier, approver_id, decision, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (approval_id) DO NOTHING RETURNING *`,
      [input.approvalId, input.capabilityKind, input.projectId, input.goalId, input.commandId, input.action, input.target, input.policyVersion, input.controlEpoch, input.budgetEffectCents, input.tier, input.approverId, input.decision, input.expiresAt],
    );
    const row = inserted.rows[0] ?? (await client.query<ApprovalRow>("SELECT * FROM capability_approvals WHERE approval_id = $1 FOR SHARE", [input.approvalId])).rows[0];
    if (row === undefined) throw new CapabilityApprovalConflictError("Capability approval identity conflict");
    const identityMatches = row.capability_kind === input.capabilityKind && row.project_id === input.projectId && row.goal_id === input.goalId && row.command_id === input.commandId && row.action === input.action && row.target === input.target && row.policy_version === input.policyVersion && row.control_epoch === input.controlEpoch && Number(row.budget_effect_cents) === input.budgetEffectCents && row.tier === input.tier && row.approver_id === input.approverId && row.decision === input.decision && row.expires_at.getTime() === input.expiresAt.getTime();
    if (!identityMatches) throw new CapabilityApprovalConflictError("Capability approval identity conflict");
    const budgetInserted = await client.query<BudgetRow>(
      `INSERT INTO capability_repetition_budgets (approval_id, scope_kind, remaining_count, remaining_budget_cents, expires_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (approval_id) DO NOTHING RETURNING *`,
      [input.approvalId, scope.kind, scope.count, scope.budgetCents, scope.expiresAt],
    );
    const budget = budgetInserted.rows[0] ?? (await client.query<BudgetRow>("SELECT * FROM capability_repetition_budgets WHERE approval_id = $1 FOR SHARE", [input.approvalId])).rows[0];
    if (budget === undefined || !budgetMatchesScope(budget, scope)) throw new CapabilityApprovalConflictError("Capability repetition scope conflict");
    if (inserted.rowCount === 1) await insertJournal(client, { capabilityKind: input.capabilityKind, projectId: input.projectId, goalId: input.goalId, approvalId: input.approvalId, commandId: input.commandId, event: input.decision === "approved" ? "approval" : input.decision === "rejected" ? "rejection" : "safer_alternative", details: { tier: input.tier, ...(input.saferAlternative === undefined ? {} : { alternative: input.saferAlternative }) } });
    await client.query("COMMIT"); open = false;
    return mapApproval(row, budget);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function setCapabilitySession(pool: Pool, input: CapabilitySessionInput): Promise<CapabilitySession> {
  for (const [value, label] of [[input.sessionId, "sessionId"], [input.capabilityKind, "capabilityKind"], [input.projectId, "projectId"], [input.goalId, "goalId"], [input.selectedBy, "selectedBy"]] as const) requireText(value, label);
  const result = await pool.query<SessionRow>(
    `INSERT INTO capability_sessions (session_id, capability_kind, project_id, goal_id, full_access_mode, selected_by)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (session_id) DO NOTHING RETURNING *`,
    [input.sessionId, input.capabilityKind, input.projectId, input.goalId, input.fullAccessMode, input.selectedBy],
  );
  const row = result.rows[0] ?? (await pool.query<SessionRow>("SELECT * FROM capability_sessions WHERE session_id = $1", [input.sessionId])).rows[0];
  if (row === undefined || row.capability_kind !== input.capabilityKind || row.project_id !== input.projectId || row.goal_id !== input.goalId || row.full_access_mode !== input.fullAccessMode || row.selected_by !== input.selectedBy) throw new CapabilityApprovalConflictError("Capability session identity conflict");
  return mapSession(row);
}

export async function getCapabilitySession(pool: QueryExecutor, capabilityKind: string, projectId: string, goalId: string): Promise<CapabilitySession | undefined> {
  const result = await pool.query<SessionRow>("SELECT * FROM capability_sessions WHERE capability_kind = $1 AND project_id = $2 AND goal_id = $3 ORDER BY selected_at DESC, session_id DESC LIMIT 1", [capabilityKind, projectId, goalId]);
  return result.rows[0] === undefined ? undefined : mapSession(result.rows[0]);
}

export async function consumeCapabilityApproval(pool: Pool, input: CapabilityConsumptionInput): Promise<CapabilityConsumptionResult> {
  for (const [value, label] of [[input.approvalId, "approvalId"], [input.capabilityKind, "capabilityKind"], [input.projectId, "projectId"], [input.goalId, "goalId"], [input.commandId, "commandId"], [input.action, "action"], [input.target, "target"], [input.controlEpoch, "controlEpoch"]] as const) requireText(value, label);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const result = await client.query<ApprovalRow>("SELECT * FROM capability_approvals WHERE approval_id = $1 FOR SHARE", [input.approvalId]);
    const approval = result.rows[0];
    if (approval === undefined || approval.capability_kind !== input.capabilityKind || approval.project_id !== input.projectId || approval.goal_id !== input.goalId || approval.action !== input.action || approval.target !== input.target || approval.policy_version !== input.policyVersion || approval.control_epoch !== input.controlEpoch || Number(approval.budget_effect_cents) !== input.budgetEffectCents) throw new CapabilityApprovalScopeError("Capability request does not match the exact capability identity or Goal-scoped approval");
    if (approval.revoked_at !== null) throw new CapabilityApprovalRevokedError("Capability approval is revoked");
    if (approval.decision !== "approved") throw new CapabilityApprovalRejectedError("Capability approval was not approved");
    const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    if (approval.expires_at <= now) throw new CapabilityApprovalExpiredError("Capability approval is expired");
    const budgetResult = await client.query<BudgetRow>("SELECT * FROM capability_repetition_budgets WHERE approval_id = $1 FOR UPDATE", [input.approvalId]);
    const budget = budgetResult.rows[0];
    if (budget === undefined) throw new CapabilityApprovalError("Capability repetition budget is missing");
    const existing = await client.query<{ approval_id: string; action: string; target: string; policy_version: number; budget_effect_cents: string }>("SELECT approval_id, action, target, policy_version, budget_effect_cents FROM capability_repetition_claims WHERE capability_kind = $1 AND goal_id = $2 AND command_id = $3 FOR SHARE", [input.capabilityKind, input.goalId, input.commandId]);
    if (existing.rowCount === 1) {
      const claim = existing.rows[0]!;
      if (claim.approval_id !== input.approvalId || claim.action !== input.action || claim.target !== input.target || claim.policy_version !== input.policyVersion || Number(claim.budget_effect_cents) !== input.budgetEffectCents) throw new CapabilityApprovalConflictError("Command identity was reused with different capability content");
      await client.query("COMMIT"); open = false;
      return { consumed: false, remainingCount: budget.remaining_count === null ? null : Number(budget.remaining_count), remainingBudgetCents: budget.remaining_budget_cents === null ? null : Number(budget.remaining_budget_cents) };
    }
    if (budget.expires_at !== null && budget.expires_at <= now) throw new CapabilityApprovalExpiredError("Capability repetition scope is expired");
    if (budget.remaining_count !== null && Number(budget.remaining_count) <= 0) throw new RepetitionBudgetExhaustedError("Capability repetition count is exhausted");
    if (budget.remaining_budget_cents !== null && Number(budget.remaining_budget_cents) < input.budgetEffectCents) throw new RepetitionBudgetExhaustedError("Capability repetition budget is exhausted");
    await client.query(`INSERT INTO capability_repetition_claims (claim_id, approval_id, capability_kind, project_id, goal_id, command_id, action, target, policy_version, budget_effect_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [randomUUID(), input.approvalId, input.capabilityKind, input.projectId, input.goalId, input.commandId, input.action, input.target, input.policyVersion, input.budgetEffectCents]);
    const updated = await client.query<BudgetRow>("UPDATE capability_repetition_budgets SET remaining_count = CASE WHEN remaining_count IS NULL THEN NULL ELSE remaining_count - 1 END, remaining_budget_cents = CASE WHEN remaining_budget_cents IS NULL THEN NULL ELSE remaining_budget_cents - $2 END WHERE approval_id = $1 RETURNING *", [input.approvalId, input.budgetEffectCents]);
    const next = updated.rows[0]!;
    await insertJournal(client, { capabilityKind: input.capabilityKind, projectId: input.projectId, goalId: input.goalId, approvalId: input.approvalId, commandId: input.commandId, event: "effect_result", details: { outcome: "consumed", action: input.action, target: input.target } });
    await client.query("COMMIT"); open = false;
    return { consumed: true, remainingCount: next.remaining_count === null ? null : Number(next.remaining_count), remainingBudgetCents: next.remaining_budget_cents === null ? null : Number(next.remaining_budget_cents) };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
