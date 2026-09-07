import type {
  ExecutionBindingEvidence,
  ExecutionRef,
  ExecutionAdmission,
  ExecutionKernelPort,
  InvocationRef,
  ModelIdentity,
} from "@maestro/domain";
import type { Pool } from "pg";

export type NativeExecutionAdmissionKind = "conversation" | "worker" | "head" | "semantic_review" | "encore_reviewer" | "team_lead_helper";

export interface NativeExecutionBindingInput {
  readonly execution: ExecutionRef;
  readonly invocation: InvocationRef;
  readonly workerId?: string;
  readonly goalId: string;
  readonly projectId: string;
  readonly admissionKind: NativeExecutionAdmissionKind;
  readonly admission: ExecutionAdmission;
  readonly actualModel: ModelIdentity;
  readonly binding?: ExecutionBindingEvidence;
}

export class NativeExecutionBindingError extends Error {}

function identityMatches(left: ModelIdentity, right: ModelIdentity): boolean {
  return left.provider === right.provider && left.id === right.id;
}

function compareExisting(
  row: Record<string, unknown>,
  input: NativeExecutionBindingInput,
  selected: ModelIdentity,
  binding: ExecutionBindingEvidence | undefined,
): boolean {
  return (
    row.execution_ref === input.execution &&
    row.invocation_ref === input.invocation &&
    (input.workerId === undefined ? row.worker_id === null : row.worker_id === input.workerId) &&
    row.goal_id === input.goalId &&
    row.project_id === input.projectId &&
    row.admission_kind === input.admissionKind &&
    row.operator_id === input.admission.context.operatorId &&
    row.mission_bundle_id === input.admission.context.missionBundleId &&
    row.policy_version === input.admission.context.policyVersion &&
    row.idempotency_key === input.admission.idempotencyKey &&
    String(row.fencing_token ?? "") === String(input.admission.context.fencingToken ?? "") &&
    row.selected_model_provider === selected.provider &&
    row.selected_model_id === selected.id &&
    row.actual_model_provider === input.actualModel.provider &&
    row.actual_model_id === input.actualModel.id &&
    (row.account_ref ?? null) === (binding?.accountRef ?? input.admission.context.accountRef ?? null) &&
    (row.gateway_instance_id ?? null) === (binding?.gatewayInstanceId ?? null) &&
    (row.gateway_binding_id ?? null) === (binding?.gatewayBindingId ?? null) &&
    (row.data_policy_hash ?? null) === (binding?.dataPolicyHash ?? null)
  );
}

/**
 * Record only the immutable identity of a native admission. This is called
 * after gateway admission and before the first provider prompt/effect.
 * Duplicate identical retries are safe; a reused execution, invocation, or
 * command identity with changed binding data is rejected.
 */
export async function recordNativeExecutionBinding(pool: Pool, input: NativeExecutionBindingInput): Promise<void> {
  const selected = input.admission.modelPolicy.length === 1 ? input.admission.modelPolicy[0] : undefined;
  if (selected === undefined || !/^[^/\s]+\/[^/\s]+$/.test(selected))
    throw new NativeExecutionBindingError("native binding selected model is invalid");
  const selectedIdentity = { provider: selected.slice(0, selected.indexOf("/")), id: selected.slice(selected.indexOf("/") + 1) };
  if (!identityMatches(selectedIdentity, input.actualModel))
    throw new NativeExecutionBindingError("native binding provider model identity mismatch");
  if (input.admission.context.goalId !== input.goalId || input.admission.context.projectId !== input.projectId)
    throw new NativeExecutionBindingError("native binding Goal/project context mismatch");
  if (input.admission.idempotencyKey.trim() === "") throw new NativeExecutionBindingError("native binding requires an idempotency key");
  if (input.binding !== undefined && !identityMatches(input.binding.model, input.actualModel))
    throw new NativeExecutionBindingError("native gateway binding model identity mismatch");

  const values = [
    input.execution,
    input.invocation,
    input.workerId ?? null,
    input.goalId,
    input.projectId,
    input.admissionKind,
    input.admission.context.operatorId,
    input.admission.context.missionBundleId,
    input.admission.context.policyVersion,
    input.admission.idempotencyKey,
    input.admission.context.fencingToken ?? null,
    selectedIdentity.provider,
    selectedIdentity.id,
    input.actualModel.provider,
    input.actualModel.id,
    input.binding?.accountRef ?? input.admission.context.accountRef ?? null,
    input.binding?.gatewayInstanceId ?? null,
    input.binding?.gatewayBindingId ?? null,
    input.binding?.dataPolicyHash ?? null,
  ];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO native_execution_bindings
        (binding_id, execution_ref, invocation_ref, worker_id, goal_id, project_id, admission_kind, operator_id, mission_bundle_id, policy_version, idempotency_key, fencing_token, selected_model_provider, selected_model_id, actual_model_provider, actual_model_id, account_ref, gateway_instance_id, gateway_binding_id, data_policy_hash)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::bigint, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT DO NOTHING
       RETURNING binding_id`,
      values,
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<Record<string, unknown>>(
        `SELECT execution_ref, invocation_ref, worker_id, goal_id, project_id, admission_kind, operator_id, mission_bundle_id, policy_version, idempotency_key, fencing_token, selected_model_provider, selected_model_id, actual_model_provider, actual_model_id, account_ref, gateway_instance_id, gateway_binding_id, data_policy_hash
           FROM native_execution_bindings
          WHERE execution_ref = $1 OR invocation_ref = $2 OR (admission_kind = $6 AND idempotency_key = $10)
          FOR SHARE`,
        values,
      );
      if (existing.rowCount !== 1 || !compareExisting(existing.rows[0]!, input, selectedIdentity, input.binding))
        throw new NativeExecutionBindingError("native execution binding identity conflict");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface NativeExecutionBindingCapability {
  readonly execution: ExecutionRef;
  readonly invocation: InvocationRef;
  readonly workerId?: string;
  readonly goalId: string;
  readonly projectId: string;
  readonly admissionKind: NativeExecutionAdmissionKind;
  readonly admission?: ExecutionAdmission;
}

/**
 * Shared bridge for native call sites. Legacy injected kernels intentionally
 * skip identity evidence; native kernels expose the optional binding method and
 * therefore fail closed if durable identity recording fails.
 */
export async function recordNativeExecutionBindingIfSupported(
  pool: Pool,
  kernel: ExecutionKernelPort,
  input: NativeExecutionBindingCapability,
): Promise<boolean> {
  if (input.admission === undefined || kernel.getExecutionBinding === undefined) return false;
  await recordNativeExecutionBinding(pool, {
    ...input,
    admission: input.admission,
    actualModel: await kernel.getModelIdentity(input.execution),
    binding: await kernel.getExecutionBinding(input.execution),
  });
  return true;
}
