import type { CriticalActionApprovalInput, CriticalActionInput } from "@maestro/contracts";
import { AuthorityApprovalConflictError, issueAuthorityApproval, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";
import {
  AuthorizedEffectExecutor,
  type ActionRequest,
  type AuthorityDecision,
  type AuthorityRepository,
} from "@maestro/authority";

export interface CriticalActionService {
  performCriticalAction(
    goalId: string,
    input: CriticalActionInput,
    commandId: string,
    operator: OperatorContext,
  ): Promise<AuthorityDecision>;
  approveAndPerformCriticalAction(
    goalId: string,
    input: CriticalActionApprovalInput,
    commandId: string,
    operator: OperatorContext,
  ): Promise<AuthorityDecision>;
}

export interface CriticalActionServiceDependencies {
  pool: Pool;
  repository: AuthorityRepository;
  /** Only this explicitly configured operator may issue CEO approvals. */
  ceoOperatorId?: string;
  /** The only externally observable side effect. Never invoked unless the durable gateway allows the action. */
  effect: (request: ActionRequest) => Promise<void>;
  /** Current durable Goal control epoch, read the same way the rest of the control plane reads it. */
  getControlEpoch: (projectId: string, goalId: string) => Promise<string>;
  clock?: () => Date;
}

export class CriticalActionApprovalForbiddenError extends Error {
  constructor() {
    super("Only the configured CEO operator may approve critical actions");
    this.name = "CriticalActionApprovalForbiddenError";
  }
}
export class CriticalActionApprovalExpiredError extends Error {
  constructor() {
    super("Critical action approval must expire in the future");
    this.name = "CriticalActionApprovalExpiredError";
  }
}
export class CriticalActionApprovalConflictError extends Error {
  constructor() {
    super("Approval command ID was reused with different content");
    this.name = "CriticalActionApprovalConflictError";
  }
}

export class CriticalActionUnavailableError extends Error {
  constructor() {
    super("Durable store is unavailable");
    this.name = new.target.name;
  }
}

/**
 * Builds the single Phase 1 critical-action call site on top of the pure
 * authority gateway. This function performs no evaluation itself: it only
 * assembles the ActionRequest from durable Goal control state and defers to
 * AuthorizedEffectExecutor, which is the sole caller of the injected effect.
 */
export function createCriticalActionService(deps: CriticalActionServiceDependencies): CriticalActionService {
  const executor = new AuthorizedEffectExecutor(deps.repository, deps.clock);
  return {
    async performCriticalAction(goalId, input, commandId, operator) {
      let controlEpoch: string;
      try {
        controlEpoch = await deps.getControlEpoch(input.projectId, goalId);
      } catch {
        throw new CriticalActionUnavailableError();
      }
      const request: ActionRequest = {
        commandId,
        projectId: input.projectId,
        goalId,
        actorId: operator.operatorId,
        action: input.action,
        target: input.target,
        policyVersion: input.policyVersion,
        budgetEffectCents: input.budgetEffectCents,
        controlEpoch,
      };
      return executor.execute(request, () => deps.effect(request));
    },
    async approveAndPerformCriticalAction(goalId, input, commandId, operator) {
      if (deps.ceoOperatorId === undefined || operator.operatorId !== deps.ceoOperatorId) {
        throw new CriticalActionApprovalForbiddenError();
      }
      const expiresAt = new Date(input.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= (deps.clock?.() ?? new Date())) {
        throw new CriticalActionApprovalExpiredError();
      }
      try {
        await issueAuthorityApproval(deps.pool, {
          recordId: commandId,
          commandId,
          projectId: input.projectId,
          goalId,
          actorId: operator.operatorId,
          action: input.action,
          target: input.target,
          policyVersion: input.policyVersion,
          budgetEffectCents: input.budgetEffectCents,
          expiresAt,
        });
      } catch (error) {
        if (error instanceof AuthorityApprovalConflictError) throw new CriticalActionApprovalConflictError();
        throw error;
      }
      return this.performCriticalAction(goalId, input, commandId, operator);
    },
  };
}
