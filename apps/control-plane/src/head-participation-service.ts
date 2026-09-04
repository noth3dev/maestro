import { randomUUID } from "node:crypto";
import type { HeadParticipationInput, HeadParticipation } from "@maestro/contracts";
import type { ExecutionKernelPort, GoalHeadParticipation } from "@maestro/domain";
import {
  activateHeadParticipation,
  markHeadActivationSpawnStarted,
  bindHeadActivationInvocation,
  resetHeadActivationAfterSpawnFailure,
  resetHeadActivationAfterCancellation,
  markHeadActivationOrphaned,
  markHeadParticipationActive,
  sleepHeadParticipation,
  assertProjectRole,
  type OperatorContext,
} from "@maestro/persistence";
import type { Pool } from "pg";

export interface HeadParticipationService {
  activate(goalId: string, input: HeadParticipationInput, operator: OperatorContext, commandId: string): Promise<HeadParticipation>;
}

export interface HeadParticipationServiceDependencies {
  pool: Pool;
  kernel: ExecutionKernelPort;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}

export class HeadGoalNotFoundError extends Error {
  constructor() { super("Goal was not found"); this.name = "HeadGoalNotFoundError"; }
}
export class HeadProjectMismatchError extends Error {
  constructor() { super("Head activation project does not match the Goal"); this.name = "HeadProjectMismatchError"; }
}
export class HeadContractMismatchError extends Error {
  constructor() { super("Head activation contract does not match the Goal contract"); this.name = "HeadContractMismatchError"; }
}

/**
 * Authenticated control-plane composition for one Goal-scoped Head. The
 * durable participation reservation is made before the provider session is
 * created. The opaque execution reference is written back only after the
 * provider confirms root creation, so a provider failure leaves a retryable
 * `starting` reservation instead of fabricating an active Head.
 */
export function createHeadParticipationService(deps: HeadParticipationServiceDependencies): HeadParticipationService {
  return {
    async activate(goalId, input, operator, _commandId) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, "concertmaster");
      const goal = await deps.pool.query<{ project_id: string; task_contract_id: string | null }>(
        "SELECT project_id, task_contract_id FROM goals WHERE goal_id = $1",
        [goalId],
      );
      if (goal.rowCount !== 1) throw new HeadGoalNotFoundError();
      const row = goal.rows[0]!;
      if (row.project_id !== input.projectId) throw new HeadProjectMismatchError();
      const contractId = input.contractId ?? row.task_contract_id ?? undefined;
      if (row.task_contract_id !== null && contractId !== row.task_contract_id) throw new HeadContractMismatchError();
      if (contractId !== undefined) {
        const contract = await deps.pool.query<{ project_id: string; launch_state: string }>(
          "SELECT content->'project'->>'projectId' AS project_id, launch_state FROM task_contracts WHERE contract_id = $1",
          [contractId],
        );
        if (contract.rowCount !== 1 || contract.rows[0]!.project_id !== input.projectId || contract.rows[0]!.launch_state !== "launched") {
          throw new HeadContractMismatchError();
        }
      }
      return deps.withGoalLease(goalId, async (proof) => {
        const reserved = await activateHeadParticipation(deps.pool, {
          goalId,
          departmentId: input.departmentId,
          ...(input.headRoleId === undefined ? {} : { headRoleId: input.headRoleId }),
          ...(contractId === undefined ? {} : { contractId }),
          ...(input.contextId === undefined ? {} : { contextId: input.contextId }),
          requestedContribution: input.requestedContribution,
          urgency: input.urgency,
          contextScope: input.contextScope,
          budgetEffect: input.budgetEffect,
          reason: input.reason,
          ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
          commandId: _commandId,
        }, proof);
        if (reserved.status === "active") return toWire(reserved);
        const shouldSpawn = await markHeadActivationSpawnStarted(deps.pool, goalId, reserved.departmentId, _commandId, proof);
        if (!shouldSpawn) return toWire(reserved);
        let spawned: import("@maestro/domain").SpawnedInvocation;
        try {
          spawned = await deps.kernel.spawn({ name: `head:${reserved.departmentId}:${randomUUID()}` });
        } catch (error) {
          await resetHeadActivationAfterSpawnFailure(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
          throw error;
        }
        try {
          const bound = await bindHeadActivationInvocation(deps.pool, goalId, reserved.departmentId, _commandId, spawned.execution, spawned.invocation);
          if (!bound) throw new Error("Head activation provider binding was not accepted");
        } catch (error) {
          const cancellation = await deps.kernel.cancel(spawned.invocation).catch(() => ({ cancelled: false }));
          if (cancellation.cancelled) await resetHeadActivationAfterCancellation(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
          else await markHeadActivationOrphaned(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
          throw error;
        }
        let active: GoalHeadParticipation;
        try {
          active = await markHeadParticipationActive(
          deps.pool,
          goalId,
          reserved.departmentId,
          spawned.execution,
          proof,
          reserved.headRoleId,
          _commandId,
        );
        } catch (error) {
          const cancellation = await deps.kernel.cancel(spawned.invocation).catch(() => ({ cancelled: false }));
          if (cancellation.cancelled) await resetHeadActivationAfterCancellation(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
          else await markHeadActivationOrphaned(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
          throw error;
        }
        // Activation must dispatch the bounded Goal context; an active Head
        // with no prompt is an idle provider session that cannot participate.
        // This happens after the durable active transition, so provider work
        // never holds the persistence transaction.
        try {
          await deps.kernel.prompt(spawned.execution, [
            `You are the ${reserved.departmentId} Department Head for Goal ${goalId}.`,
            `Contribution: ${input.requestedContribution}.`,
            `Urgency: ${input.urgency}.`,
            `Context scope: ${input.contextScope.join(", ")}.`,
            `Budget effect: ${input.budgetEffect}.`,
            `Reason: ${input.reason}.`,
            "Work only within this Goal and report evidence and blockers; do not perform unapproved critical actions.",
          ].join("\n"));
        } catch (error) {
          // A failed initial dispatch must not leave a live provider session
          // behind an apparently active durable Head.
          const cancellation = await deps.kernel.cancel(spawned.invocation).catch(() => ({ cancelled: false }));
          if (cancellation.cancelled) {
            await sleepHeadParticipation(deps.pool, goalId, reserved.departmentId, proof, reserved.headRoleId).catch(async () => {
              await markHeadActivationOrphaned(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
            });
          } else {
            await markHeadActivationOrphaned(deps.pool, goalId, reserved.departmentId, _commandId).catch(() => {});
          }
          throw error;
        }
        return toWire(active);
      });
    },
  };
}

function toWire(value: GoalHeadParticipation): HeadParticipation {
  return {
    goalId: value.goalId,
    departmentId: value.departmentId,
    headRoleId: value.headRoleId,
    contractId: value.contractId,
    contextId: value.contextId,
    status: value.status,
    activeSessionRef: value.activeSessionRef,
  };
}
