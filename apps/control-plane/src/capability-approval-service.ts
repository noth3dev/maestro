import type { Pool } from "pg";
import {
  consumeCapabilityApproval,
  createCapabilityApproval,
  getCapabilitySession,
  setCapabilitySession,
  type CapabilityApproval,
  type CapabilityApprovalInput,
  type CapabilityConsumptionInput,
  type CapabilityConsumptionResult,
  type CapabilitySession,
  type CapabilitySessionInput,
} from "@maestro/persistence";
import type { CapabilityTier, FullAccessMode } from "@maestro/persistence";

export type ApprovalActorKind = "department_head" | "encore_council" | "user";

export interface ApprovalActor {
  readonly actorId: string;
  readonly kind: ApprovalActorKind;
  readonly departmentId?: string;
  readonly active?: boolean;
}

export interface CapabilityApprovalLedger {
  createApproval(input: CapabilityApprovalInput): Promise<CapabilityApproval>;
  setSession(input: CapabilitySessionInput): Promise<CapabilitySession>;
  getSession(capabilityKind: string, projectId: string, goalId: string): Promise<CapabilitySession | undefined>;
  consumeApproval(input: CapabilityConsumptionInput): Promise<CapabilityConsumptionResult>;
}

export interface CapabilityApprovalRequest extends Omit<CapabilityApprovalInput, "approverId" | "decision" | "tier"> {
  readonly requiredTier: CapabilityTier;
  readonly headDisagreement?: boolean;
  readonly saferAlternative: string;
  readonly sessionId?: string;
  readonly fullAccessMode?: FullAccessMode;
}

export interface CapabilityApprovalServiceDependencies {
  readonly ledger?: CapabilityApprovalLedger;
  readonly pool?: Pool;
  readonly resolveDepartmentHead: (input: { projectId: string; goalId: string }) => Promise<ApprovalActor | undefined>;
  readonly resolveEncoreCouncil: (input: { projectId: string; goalId: string }) => Promise<ApprovalActor | undefined>;
  readonly clock?: () => Date;
}

export class CapabilityApprovalUnauthorizedError extends Error {
  constructor(message = "Approval actor is not authorized for the required tier") { super(message); this.name = "CapabilityApprovalUnauthorizedError"; }
}
export class CapabilityApprovalEscalationError extends Error {
  constructor() { super("Head disagreement must escalate to Encore Council"); this.name = "CapabilityApprovalEscalationError"; }
}
export class CapabilityApprovalInvalidRequestError extends Error {
  constructor(message: string) { super(message); this.name = "CapabilityApprovalInvalidRequestError"; }
}

export type CapabilityApprovalResult =
  | { readonly status: "approved"; readonly approval: CapabilityApproval }
  | { readonly status: "intermediate_skipped"; readonly skippedTier: "Department Head" | "Encore Council"; readonly session: CapabilitySession };

export interface CapabilityRejectionResult {
  readonly status: "rejected";
  readonly alternative: string;
  readonly approval: CapabilityApproval;
}

export interface CapabilityApprovalService {
  approve(request: CapabilityApprovalRequest, actor: ApprovalActor): Promise<CapabilityApprovalResult>;
  reject(request: CapabilityApprovalRequest, actor: ApprovalActor): Promise<CapabilityRejectionResult>;
  selectFullAccessMode(request: Pick<CapabilityApprovalRequest, "capabilityKind" | "projectId" | "goalId" | "sessionId" | "fullAccessMode">, actor: ApprovalActor): Promise<CapabilitySession>;
  consume(input: CapabilityConsumptionInput): Promise<CapabilityConsumptionResult>;
}

function postgresLedger(pool: Pool): CapabilityApprovalLedger {
  return {
    createApproval: (input) => createCapabilityApproval(pool, input),
    setSession: (input) => setCapabilitySession(pool, input),
    getSession: (kind, projectId, goalId) => getCapabilitySession(pool, kind, projectId, goalId),
    consumeApproval: (input) => consumeCapabilityApproval(pool, input),
  };
}

function requireText(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === "") throw new CapabilityApprovalInvalidRequestError(`${field} is required`);
  return value;
}

function effectiveTier(request: CapabilityApprovalRequest): CapabilityTier {
  if (request.headDisagreement && request.requiredTier === "Department Head") return "Encore Council";
  return request.requiredTier;
}

function isIntermediate(tier: CapabilityTier): tier is "Department Head" | "Encore Council" {
  return tier === "Department Head" || tier === "Encore Council";
}

export function createCapabilityApprovalService(deps: CapabilityApprovalServiceDependencies): CapabilityApprovalService {
  const ledgerCandidate = deps.ledger ?? (deps.pool === undefined ? undefined : postgresLedger(deps.pool));
  if (ledgerCandidate === undefined) throw new CapabilityApprovalInvalidRequestError("Capability approval ledger is required");
  const ledger: CapabilityApprovalLedger = ledgerCandidate;
  const clock = deps.clock ?? (() => new Date());

  async function sessionFor(request: CapabilityApprovalRequest): Promise<CapabilitySession | undefined> {
    return ledger.getSession(request.capabilityKind, request.projectId, request.goalId);
  }

  async function assertSession(request: CapabilityApprovalRequest, actor: ApprovalActor, required: boolean): Promise<CapabilitySession | undefined> {
    const session = await sessionFor(request);
    if (!required) return session;
    if (session === undefined) throw new CapabilityApprovalUnauthorizedError("Full-access mode must be selected for this session");
    if (request.sessionId !== undefined && session.sessionId !== request.sessionId) throw new CapabilityApprovalUnauthorizedError("Approval session does not match the Goal");
    if (request.fullAccessMode !== undefined && session.fullAccessMode !== request.fullAccessMode) throw new CapabilityApprovalUnauthorizedError("Full-access mode does not match the recorded session");
    if (session.selectedBy !== actor.actorId) throw new CapabilityApprovalUnauthorizedError("Only the user who selected full access may use that session");
    return session;
  }

  async function assertActor(request: CapabilityApprovalRequest, actor: ApprovalActor, tier: CapabilityTier): Promise<void> {
    if (tier === "automatic progress") throw new CapabilityApprovalUnauthorizedError("Automatic progress does not accept an approval actor");
    if (tier === "user") {
      if (actor.kind !== "user") throw new CapabilityApprovalUnauthorizedError("Tier 4 approval requires the user");
      await assertSession(request, actor, true);
      return;
    }
    if (tier === "Department Head") {
      const head = await deps.resolveDepartmentHead({ projectId: request.projectId, goalId: request.goalId });
      const departmentId = head?.departmentId;
      if (head === undefined || head.active === false || head.kind !== "department_head" || departmentId === undefined || head.actorId !== actor.actorId || actor.kind !== "department_head" || actor.departmentId !== departmentId) {
        throw new CapabilityApprovalUnauthorizedError("Only the active Goal-scoped Department Head may approve");
      }
      return;
    }
    const council = await deps.resolveEncoreCouncil({ projectId: request.projectId, goalId: request.goalId });
    if (council === undefined) {
      if (request.headDisagreement) throw new CapabilityApprovalEscalationError();
      throw new CapabilityApprovalUnauthorizedError("Only the Encore Council for this Goal may approve");
    }
    if (council.active === false || council.kind !== "encore_council" || council.actorId !== actor.actorId || actor.kind !== "encore_council") {
      throw new CapabilityApprovalUnauthorizedError("Only the Encore Council for this Goal may approve");
    }
  }

  async function record(request: CapabilityApprovalRequest, actor: ApprovalActor, decision: CapabilityApprovalInput["decision"], tier: CapabilityTier): Promise<CapabilityApproval> {
    const approvalId = requireText(request.approvalId, "approvalId");
    if (!(request.expiresAt instanceof Date) || request.expiresAt <= clock()) throw new CapabilityApprovalInvalidRequestError("expiresAt must be in the future");
    return ledger.createApproval({
      approvalId,
      capabilityKind: request.capabilityKind,
      projectId: request.projectId,
      goalId: request.goalId,
      commandId: request.commandId,
      action: request.action,
      target: request.target,
      policyVersion: request.policyVersion,
      controlEpoch: request.controlEpoch,
      budgetEffectCents: request.budgetEffectCents,
      tier,
      approverId: actor.actorId,
      decision,
      expiresAt: request.expiresAt,
      repetitionScope: request.repetitionScope,
    });
  }

  async function approve(request: CapabilityApprovalRequest, actor: ApprovalActor): Promise<CapabilityApprovalResult> {
    const tier = effectiveTier(request);
    if (request.headDisagreement && request.requiredTier === "Department Head" && tier !== "Encore Council") throw new CapabilityApprovalEscalationError();
    if (request.fullAccessMode === "skip_intermediate_approvals" && isIntermediate(tier)) {
      const session = await assertSession(request, actor, true);
      if (actor.kind !== "user") throw new CapabilityApprovalUnauthorizedError("Skipping intermediate approvals is user-selected");
      return { status: "intermediate_skipped", skippedTier: tier, session: session! };
    }
    await assertActor(request, actor, tier);
    return { status: "approved", approval: await record(request, actor, "approved", tier) };
  }

  async function reject(request: CapabilityApprovalRequest, actor: ApprovalActor): Promise<CapabilityRejectionResult> {
    const tier = effectiveTier(request);
    await assertActor(request, actor, tier);
    const alternative = requireText(request.saferAlternative, "saferAlternative");
    const persisted = await record(request, actor, "safer_alternative", tier);
    return { status: "rejected", alternative, approval: persisted };
  }

  async function selectFullAccessMode(request: Pick<CapabilityApprovalRequest, "capabilityKind" | "projectId" | "goalId" | "sessionId" | "fullAccessMode">, actor: ApprovalActor): Promise<CapabilitySession> {
    if (actor.kind !== "user") throw new CapabilityApprovalUnauthorizedError("Only the user may select full-access mode");
    const sessionId = requireText(request.sessionId, "sessionId");
    if (request.fullAccessMode === undefined) throw new CapabilityApprovalInvalidRequestError("fullAccessMode is required");
    return ledger.setSession({ sessionId, capabilityKind: request.capabilityKind, projectId: request.projectId, goalId: request.goalId, fullAccessMode: request.fullAccessMode, selectedBy: actor.actorId });
  }

  return {
    approve,
    reject,
    selectFullAccessMode,
    consume: (input) => ledger.consumeApproval(input),
  };
}
