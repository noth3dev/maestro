import { randomUUID } from "node:crypto";
import { TASK_CONTRACT_SCHEMA_VERSION, amendTaskContract, assertValidTaskContractSubstance, canonicalJson, createTaskContract, selectOvertureRoles, taskContractContentHash, type OvertureRoleId, type OvertureSelectionInput, type TaskContract, type TaskContractDecision, type TaskContractSubstance } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";

export class TaskContractNotFoundError extends Error {}
export class TaskContractVersionConflictError extends Error {}
export class TaskContractConflictError extends Error {}
export class TaskContractProjectBoundaryError extends Error {}
export class ExactConfirmationRequiredError extends Error {}
export class TaskContractIntegrityError extends Error {}

interface ContractRow { contract_id: string; schema_version: number; version: string; content: TaskContractSubstance; content_hash: string; launch_state: "awaiting_confirmation" | "launched"; }
type Queryable = Pick<Pool | PoolClient, "query">;
type DecisionRow = { decision_id: string; contract_id: string; contract_version: string; kind: TaskContractDecision["kind"]; evidence: Record<string, unknown>; content_hash: string | null };

export async function createDurableTaskContract(pool: Pool, contractId: string, substance: TaskContractSubstance): Promise<TaskContract> {
  assertValidTaskContractSubstance(substance);
  const contract = createTaskContract(contractId, substance, [{ decisionId: randomUUID(), kind: "created", evidence: {} }]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await insertContract(client, contract);
    if (!inserted) {
      const existing = await readContractRow(client, contractId);
      if (!existing) throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
      assertContractIntegrity(existing.row);
      if (existing.row.content_hash.trim() !== contract.contentHash) {
        throw new TaskContractConflictError(`Task contract already exists with different content: ${contractId}`);
      }
      await client.query("COMMIT");
      return toContract(existing.row, existing.decisions);
    }
    await insertDecisions(client, contract);
    await client.query("COMMIT");
    return contract;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readTaskContract(pool: Queryable, contractId: string): Promise<TaskContract | undefined> {
  const existing = await readContractRow(pool, contractId);
  if (!existing) return undefined;
  assertContractIntegrity(existing.row);
  return toContract(existing.row, existing.decisions);
}

export async function updateDurableTaskContract(pool: Pool, contractId: string, expectedVersion: number, substance: TaskContractSubstance, evidence: Record<string, unknown> = {}, decisionId?: string): Promise<TaskContract> {
  assertValidTaskContractSubstance(substance);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<ContractRow>("SELECT contract_id, schema_version, version, content, content_hash, launch_state FROM task_contracts WHERE contract_id = $1 FOR UPDATE", [contractId]);
    if (existing.rowCount !== 1) throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
    assertContractIntegrity(existing.rows[0]!);
    const priorDecisions = await client.query<DecisionRow>("SELECT decision_id, contract_id, contract_version, kind, evidence, content_hash FROM task_contract_decisions WHERE contract_id = $1 ORDER BY recorded_at, decision_id", [contractId]);
    assertDecisionIntegrity(existing.rows[0]!, priorDecisions.rows);
    const prior = toContract(existing.rows[0]!, priorDecisions.rows);
    if (decisionId !== undefined) {
      const priorCommand = priorDecisions.rows.find((decision) => decision.decision_id === decisionId);
      if (priorCommand !== undefined) {
        if (priorCommand.kind !== "amended" || priorCommand.contract_id !== contractId || canonicalJson(priorCommand.evidence) !== canonicalJson({ ...evidence, previousContentHash: priorCommand.content_hash, nextContentHash: taskContractContentHash(substance) })) throw new TaskContractConflictError("Task Contract amendment command was reused with different content");
        await client.query("COMMIT");
        return prior;
      }
    }
    if (prior.project.projectId !== substance.project.projectId) {
      throw new TaskContractProjectBoundaryError("Task Contract project boundary cannot change");
    }
    // A lost response may be retried after the amendment committed. Returning
    // the already-current identical content is the safe idempotent outcome;
    // only a genuinely different content hash needs the expected-version check.
    if (taskContractContentHash(substance) === prior.contentHash) { await client.query("COMMIT"); return prior; }
    if (prior.version !== expectedVersion) throw new TaskContractVersionConflictError(`Expected Task Contract version ${expectedVersion}, got ${prior.version}`);
    const nextHash = taskContractContentHash(substance);
    const decision: TaskContractDecision = { decisionId: decisionId ?? randomUUID(), kind: "amended", evidence: { ...evidence, previousContentHash: prior.contentHash, nextContentHash: nextHash } };
    const amended = amendTaskContract(prior, substance, decision);
    await client.query("UPDATE task_contracts SET version = $2, content = $3::jsonb, content_hash = $4, launch_state = $5, updated_at = transaction_timestamp() WHERE contract_id = $1", [contractId, amended.version, JSON.stringify(substance), amended.contentHash, amended.launchState]);
    // Only the new amendment decision is inserted; prior history is already durable.
    await insertDecisions(client, { ...amended, decisionHistory: [decision] });
    await client.query("COMMIT");
    return amended;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function selectAndRecordOvertureRoles(pool: Pool, contractId: string, input: OvertureSelectionInput, decisionId?: string): Promise<readonly OvertureRoleId[]> {
  const roles = selectOvertureRoles(input);
  const selectionDecisionId = decisionId ?? randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<ContractRow>("SELECT contract_id, schema_version, version, content, content_hash, launch_state FROM task_contracts WHERE contract_id = $1 FOR UPDATE", [contractId]);
    if (row.rowCount !== 1) throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
    assertContractIntegrity(row.rows[0]!);
    const current = row.rows[0]!;
    if (current.launch_state !== "awaiting_confirmation") throw new TaskContractConflictError("Overture roles cannot be selected after Task Contract launch");
    const evidence = { input, roles };
    const prior = await client.query<{ contract_id: string; contract_version: string; kind: TaskContractDecision["kind"]; evidence: Record<string, unknown> }>(
      "SELECT contract_id, contract_version, kind, evidence FROM task_contract_decisions WHERE decision_id = $1",
      [selectionDecisionId],
    );
    if (prior.rowCount === 1) {
      const existing = prior.rows[0]!;
      if (existing.contract_id !== contractId || existing.contract_version !== current.version || existing.kind !== "overture_selected" || canonicalJson(existing.evidence) !== canonicalJson(evidence)) {
        throw new TaskContractConflictError("Task Contract selection command was reused with different content");
      }
      await client.query("COMMIT");
      return roles;
    }
    await client.query("INSERT INTO task_contract_decisions (decision_id, contract_id, contract_version, kind, evidence, content_hash) VALUES ($1, $2, $3, 'overture_selected', $4::jsonb, $5)", [selectionDecisionId, contractId, current.version, JSON.stringify(evidence), current.content_hash.trim()]);
    await client.query("COMMIT");
    return roles;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** actorId is a role-neutral authenticated caller identity; CEO authorization is a later boundary. */
export async function recordExactTaskContractConfirmation(pool: Pool, contractId: string, version: number, contentHash: string, actorId: string, confirmationId?: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<ContractRow>("SELECT contract_id, schema_version, version, content, content_hash, launch_state FROM task_contracts WHERE contract_id = $1 FOR UPDATE", [contractId]);
    if (row.rowCount !== 1) throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
    assertContractIntegrity(row.rows[0]!);
    const current = row.rows[0]!;
    if (current.version !== String(version) || current.content_hash.trim() !== contentHash) throw new ExactConfirmationRequiredError("Confirmation content is not the exact current Task Contract");
    const id = confirmationId ?? randomUUID();
    const prior = await client.query<{ contract_id: string; contract_version: string; content_hash: string; actor_id: string }>("SELECT contract_id, contract_version, content_hash, actor_id FROM task_contract_confirmations WHERE confirmation_id = $1", [id]);
    if (prior.rowCount === 1 && (prior.rows[0]!.contract_id !== contractId || prior.rows[0]!.contract_version !== String(version) || prior.rows[0]!.content_hash.trim() !== contentHash || prior.rows[0]!.actor_id !== actorId)) throw new TaskContractConflictError("Task Contract confirmation command was reused with different content");
    await client.query("INSERT INTO task_contract_confirmations (confirmation_id, contract_id, contract_version, content_hash, actor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (contract_id, contract_version, content_hash) DO NOTHING", [id, contractId, version, contentHash, actorId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** This starts no worker or session. It only durably records an exact-confirmed launch. */
export async function launchConfirmedTaskContract(pool: Pool, contractId: string): Promise<TaskContract> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<ContractRow>("SELECT contract_id, schema_version, version, content, content_hash, launch_state FROM task_contracts WHERE contract_id = $1 FOR UPDATE", [contractId]);
    if (row.rowCount !== 1) throw new TaskContractNotFoundError(`Task contract not found: ${contractId}`);
    const current = row.rows[0]!;
    assertContractIntegrity(current);
    const decisions = await client.query<DecisionRow>(
      "SELECT decision_id, contract_id, contract_version, kind, evidence, content_hash FROM task_contract_decisions WHERE contract_id = $1 ORDER BY recorded_at, decision_id", [contractId],
    );
    assertDecisionIntegrity(current, decisions.rows);
    if (current.launch_state === "launched") { await client.query("COMMIT"); return { ...toContract(current, decisions.rows), launchState: "launched" }; }
    const confirmation = await client.query("SELECT 1 FROM task_contract_confirmations WHERE contract_id = $1 AND contract_version = $2 AND content_hash = $3", [contractId, current.version, current.content_hash]);
    if (confirmation.rowCount !== 1) throw new ExactConfirmationRequiredError("Exact current Task Contract confirmation is required before launch");
    const launched = await client.query("UPDATE task_contracts SET launch_state = 'launched', updated_at = transaction_timestamp() WHERE contract_id = $1 AND launch_state = 'awaiting_confirmation'", [contractId]);
    if (launched.rowCount !== 1) throw new ExactConfirmationRequiredError("Task Contract launch compare-and-set failed");
    await client.query("COMMIT");
    return { ...toContract(current, decisions.rows), launchState: "launched" };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function readContractRow(queryable: Queryable, contractId: string): Promise<{ row: ContractRow; decisions: readonly DecisionRow[] } | undefined> {
  const result = await queryable.query<ContractRow>("SELECT contract_id, schema_version, version, content, content_hash, launch_state FROM task_contracts WHERE contract_id = $1", [contractId]);
  if (result.rowCount !== 1) return undefined;
  const decisions = await queryable.query<DecisionRow>("SELECT decision_id, contract_id, contract_version, kind, evidence, content_hash FROM task_contract_decisions WHERE contract_id = $1 ORDER BY recorded_at, decision_id", [contractId]);
  assertDecisionIntegrity(result.rows[0]!, decisions.rows);
  return { row: result.rows[0]!, decisions: decisions.rows };
}

async function insertContract(client: PoolClient, contract: TaskContract): Promise<boolean> {
  const result = await client.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (contract_id) DO NOTHING", [contract.contractId, TASK_CONTRACT_SCHEMA_VERSION, contract.version, JSON.stringify(substanceOf(contract)), contract.contentHash, contract.launchState]);
  return result.rowCount === 1;
}
async function insertDecisions(client: PoolClient, contract: TaskContract): Promise<void> {
  for (const decision of contract.decisionHistory) await client.query("INSERT INTO task_contract_decisions (decision_id, contract_id, contract_version, kind, evidence, content_hash) VALUES ($1, $2, $3, $4, $5::jsonb, $6)", [decision.decisionId, contract.contractId, contract.version, decision.kind, JSON.stringify(decision.evidence), contract.contentHash]);
}
function substanceOf(contract: TaskContract): TaskContractSubstance {
  const { contractId: _contractId, schemaVersion: _schemaVersion, version: _version, decisionHistory: _decisionHistory, contentHash: _contentHash, launchState: _launchState, ...substance } = contract;
  return substance;
}
function assertContractIntegrity(row: ContractRow): void {
  if (row.schema_version !== TASK_CONTRACT_SCHEMA_VERSION) throw new TaskContractIntegrityError(`Unsupported Task Contract schema version: ${row.contract_id}`);
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new TaskContractIntegrityError(`Invalid Task Contract version: ${row.contract_id}`);
  if (row.launch_state !== "awaiting_confirmation" && row.launch_state !== "launched") throw new TaskContractIntegrityError(`Invalid Task Contract launch state: ${row.contract_id}`);
  try { assertValidTaskContractSubstance(row.content); } catch (error) { throw new TaskContractIntegrityError(error instanceof Error ? error.message : "invalid Task Contract content"); }
  if (taskContractContentHash(row.content) !== row.content_hash.trim()) throw new TaskContractIntegrityError(`Task Contract content hash mismatch: ${row.contract_id}`);
}

function assertDecisionIntegrity(row: ContractRow, decisions: readonly DecisionRow[]): void {
  let previousVersion = 0;
  let createdCount = 0;
  for (const decision of decisions) {
    const version = Number(decision.contract_version);
    if (decision.contract_id !== row.contract_id || !Number.isSafeInteger(version) || version < 1 || version > Number(row.version) || version < previousVersion || !Object.prototype.toString.call(decision.evidence).includes("Object")) {
      throw new TaskContractIntegrityError(`Task Contract decision history is malformed: ${row.contract_id}`);
    }
    if (!decision.content_hash || !/^[0-9a-f]{64}$/.test(decision.content_hash.trim())) throw new TaskContractIntegrityError(`Task Contract decision hash is malformed: ${row.contract_id}`);
    if (decision.kind === "created") createdCount += 1;
    previousVersion = version;
  }
  if (createdCount !== 1 || decisions[0]?.kind !== "created" || Number(decisions[0].contract_version) !== 1) throw new TaskContractIntegrityError(`Task Contract decision history has no valid creation record: ${row.contract_id}`);
  const currentHash = row.content_hash.trim();
  for (const decision of decisions.filter((item) => Number(item.contract_version) === Number(row.version))) {
    if (decision.content_hash?.trim() !== currentHash) throw new TaskContractIntegrityError(`Task Contract current decision hash mismatch: ${row.contract_id}`);
  }
}

function toContract(row: ContractRow, decisions: readonly Pick<DecisionRow, "decision_id" | "kind" | "evidence">[]): TaskContract {
  return { contractId: row.contract_id, schemaVersion: row.schema_version as typeof TASK_CONTRACT_SCHEMA_VERSION, version: Number(row.version), ...row.content, decisionHistory: decisions.map((d) => ({ decisionId: d.decision_id, kind: d.kind, evidence: d.evidence })), contentHash: row.content_hash.trim(), launchState: row.launch_state };
}
