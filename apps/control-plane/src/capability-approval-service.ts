import type { Pool } from "pg";
import {
  consumeCapabilityApproval,
  createCapabilityApproval,
  getCapabilitySession,
  getCapabilityApproval,
  findCapabilityApproval,
  revokeCapabilityApproval,
  setCapabilitySession,
  type CapabilityApproval,
  type CapabilityApprovalInput,
  type CapabilityConsumptionInput,
  type CapabilityConsumptionResult,
  type CapabilitySession,
  type CapabilitySessionInput,
} from "@maestro/persistence";
import type { CapabilityTier, FullAccessMode } from "@maestro/persistence";
import { classifyHostEffects, isExternalCapabilityKind, type ExternalCapabilityActivation, type ExternalCapabilityKind, type ExternalCapabilityRepetitionScope } from "@maestro/domain";

export type ApprovalActorKind = "department_head" | "encore_council" | "user";

export interface ApprovalActor {
  readonly actorId: string;
  readonly kind: ApprovalActorKind;
  readonly projectId: string;
  readonly goalId: string;
  readonly active: boolean;
  readonly departmentId?: string;
}

export interface CapabilityApprovalLedger {
  createApproval(input: CapabilityApprovalInput): Promise<CapabilityApproval>;
  setSession(input: CapabilitySessionInput): Promise<CapabilitySession>;
  getSession(capabilityKind: string, projectId: string, goalId: string): Promise<CapabilitySession | undefined>;
  consumeApproval(input: CapabilityConsumptionInput): Promise<CapabilityConsumptionResult>;
  getApproval?(approvalId: string): Promise<CapabilityApproval | undefined>;
  findApproval?(capabilityKind: string, projectId: string, goalId: string, commandId: string): Promise<CapabilityApproval | undefined>;
  revokeApproval?(approvalId: string, resolvedBy: string): Promise<void>;
}

export interface CapabilityApprovalEffect {
  readonly action: string;
  readonly target: string;
}

export interface CapabilityApprovalRequest extends Omit<CapabilityApprovalInput, "approverId" | "decision" | "tier"> {
  readonly effects: readonly CapabilityApprovalEffect[];
  readonly pressure: number;
  /** Optional assertion checked against the authoritative classification; never used as the source of truth. */
  readonly requiredTier?: CapabilityTier;
  readonly headDisagreement?: boolean;
  readonly saferAlternative: string;
  readonly sessionId?: string;
  readonly fullAccessMode?: FullAccessMode;
}

export interface ExternalCapabilityActivationRequest {
  readonly activationId: string; readonly capabilityKind: ExternalCapabilityKind; readonly projectId: string; readonly goalId: string;
  readonly expiresAt: Date; readonly repetitionScope: ExternalCapabilityRepetitionScope;
}
export interface ExternalCapabilityReference { readonly capabilityKind: ExternalCapabilityKind; readonly projectId: string; readonly goalId: string; }
export interface ExternalCapabilityConsumptionRequest extends ExternalCapabilityReference { readonly commandId: string; readonly budgetEffectCents?: number; }
export class ExternalCapabilityDeniedError extends Error {
  readonly reason: "not_activated" | "expired" | "revoked" | "repetition_exhausted";
  constructor(reason: ExternalCapabilityDeniedError["reason"]) { super(`External capability denied: ${reason}`); this.name = "ExternalCapabilityDeniedError"; this.reason = reason; }
}

export interface CapabilityApprovalServiceDependencies {
  readonly ledger?: CapabilityApprovalLedger;
  readonly pool?: Pool;
  readonly resolveDepartmentHead: (input: { projectId: string; goalId: string }) => Promise<ApprovalActor | undefined>;
  readonly resolveEncoreCouncil: (input: { projectId: string; goalId: string }) => Promise<ApprovalActor | undefined>;
  readonly authorizeActor: (input: { actor: ApprovalActor; projectId: string; goalId: string }) => Promise<boolean>;
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
  activateExternalCapability(request: ExternalCapabilityActivationRequest, actor: ApprovalActor): Promise<ExternalCapabilityActivation>;
  isExternalCapabilityActive(reference: ExternalCapabilityReference): Promise<boolean>;
  revokeExternalCapability(reference: ExternalCapabilityReference, actor: ApprovalActor): Promise<void>;
  consumeExternalCapability(request: ExternalCapabilityConsumptionRequest): Promise<CapabilityConsumptionResult>;
}

function postgresLedger(pool: Pool): CapabilityApprovalLedger {
  return {
    createApproval: (input) => createCapabilityApproval(pool, input),
    setSession: (input) => setCapabilitySession(pool, input),
    getSession: (kind, projectId, goalId) => getCapabilitySession(pool, kind, projectId, goalId),
    consumeApproval: (input) => consumeCapabilityApproval(pool, input),
    getApproval: (approvalId) => getCapabilityApproval(pool, approvalId),
    findApproval: (kind, projectId, goalId, commandId) => findCapabilityApproval(pool, kind, projectId, goalId, commandId),
    revokeApproval: (approvalId, resolvedBy) => revokeCapabilityApproval(pool, approvalId, resolvedBy),
  };
}

function requireText(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === "") throw new CapabilityApprovalInvalidRequestError(`${field} is required`);
  return value;
}

function classifyRequest(request: CapabilityApprovalRequest): ReturnType<typeof classifyHostEffects> {
  if (request.effects.length === 0) throw new CapabilityApprovalInvalidRequestError("effects must contain at least one effect");
  const matchingEffect = request.effects.some((effect) => effect.action === request.action && effect.target === request.target);
  if (!matchingEffect) throw new CapabilityApprovalInvalidRequestError("approval identity must be one of the classified block effects");
  try {
    const classification = classifyHostEffects(request.effects.map((effect) => effect.action), request.pressure);
    if (request.requiredTier !== undefined && request.requiredTier !== classification.tier && !(request.headDisagreement && request.requiredTier === "Department Head" && classification.tier === "Encore Council")) {
      throw new CapabilityApprovalInvalidRequestError("requiredTier does not match the authoritative host-effect classification");
    }
    return classification;
  } catch (error) {
    if (error instanceof CapabilityApprovalInvalidRequestError) throw error;
    const message = error instanceof Error ? error.message : "host-effect classification failed";
    throw new CapabilityApprovalInvalidRequestError(message);
  }
}

function effectiveTier(request: CapabilityApprovalRequest, classifiedTier: CapabilityTier): CapabilityTier {
  return request.headDisagreement && classifiedTier === "Department Head" ? "Encore Council" : classifiedTier;
}

function isIntermediate(tier: CapabilityTier): tier is "Department Head" | "Encore Council" {
  return tier === "Department Head" || tier === "Encore Council";
}

export function createCapabilityApprovalService(deps: CapabilityApprovalServiceDependencies): CapabilityApprovalService {
  const ledgerCandidate = deps.ledger ?? (deps.pool === undefined ? undefined : postgresLedger(deps.pool));
  if (ledgerCandidate === undefined) throw new CapabilityApprovalInvalidRequestError("Capability approval ledger is required");
  const ledger: CapabilityApprovalLedger = ledgerCandidate;
  const clock = deps.clock ?? (() => new Date());
  const localExternalActivations = new Map<string, ExternalCapabilityActivation>();
  const externalKey = (kind: string, projectId: string, goalId: string) => `${kind}:${projectId}:${goalId}`;

  async function sessionFor(request: CapabilityApprovalRequest): Promise<CapabilitySession | undefined> {
    return ledger.getSession(request.capabilityKind, request.projectId, request.goalId);
  }

  async function assertSession(request: CapabilityApprovalRequest, actor: ApprovalActor, required: boolean): Promise<CapabilitySession | undefined> {
    const session = await sessionFor(request);
    if (!required) return session;
    if (session === undefined || request.sessionId === undefined || request.fullAccessMode === undefined) throw new CapabilityApprovalUnauthorizedError("Full-access mode requires an explicit Goal-bound session and mode");
    if (session.sessionId !== request.sessionId) throw new CapabilityApprovalUnauthorizedError("Approval session does not match the Goal");
    if (session.fullAccessMode !== request.fullAccessMode) throw new CapabilityApprovalUnauthorizedError("Full-access mode does not match the recorded session");
    if (session.selectedBy !== actor.actorId) throw new CapabilityApprovalUnauthorizedError("Only the user who selected full access may use that session");
    return session;
  }

  async function assertUserActor(request: CapabilityApprovalRequest, actor: ApprovalActor, requireSession: boolean): Promise<CapabilitySession | undefined> {
    if (actor.kind !== "user" || actor.projectId !== request.projectId || actor.goalId !== request.goalId || actor.active !== true) throw new CapabilityApprovalUnauthorizedError("Only an active Goal-scoped user may approve");
    if (!(await deps.authorizeActor({ actor, projectId: request.projectId, goalId: request.goalId }))) throw new CapabilityApprovalUnauthorizedError("User authentication or project membership failed");
    return assertSession(request, actor, requireSession);
  }

  async function assertActor(request: CapabilityApprovalRequest, actor: ApprovalActor, tier: CapabilityTier): Promise<void> {
    if (actor.projectId !== request.projectId || actor.goalId !== request.goalId || actor.active !== true) throw new CapabilityApprovalUnauthorizedError("Approval actor is inactive or outside the Goal scope");
    if (!(await deps.authorizeActor({ actor, projectId: request.projectId, goalId: request.goalId }))) throw new CapabilityApprovalUnauthorizedError("Approval actor authentication or project membership failed");
    if (tier === "automatic progress") throw new CapabilityApprovalUnauthorizedError("Automatic progress does not accept an approval actor");
    if (tier === "user") {
      const sessionRequired = request.sessionId !== undefined || request.fullAccessMode !== undefined;
      await assertUserActor(request, actor, sessionRequired);
      return;
    }
    if (tier === "Department Head") {
      const head = await deps.resolveDepartmentHead({ projectId: request.projectId, goalId: request.goalId });
      const departmentId = head?.departmentId;
      if (head === undefined || head.projectId !== request.projectId || head.goalId !== request.goalId || head.active !== true || head.kind !== "department_head" || departmentId === undefined || head.actorId !== actor.actorId || actor.kind !== "department_head" || actor.departmentId !== departmentId) {
        throw new CapabilityApprovalUnauthorizedError("Only the active Goal-scoped Department Head may approve");
      }
      return;
    }
    const council = await deps.resolveEncoreCouncil({ projectId: request.projectId, goalId: request.goalId });
    if (council === undefined) {
      if (request.headDisagreement) throw new CapabilityApprovalEscalationError();
      throw new CapabilityApprovalUnauthorizedError("Only the Encore Council for this Goal may approve");
    }
    if (council.projectId !== request.projectId || council.goalId !== request.goalId || council.active !== true || council.kind !== "encore_council" || council.actorId !== actor.actorId || actor.kind !== "encore_council") {
      throw new CapabilityApprovalUnauthorizedError("Only the Encore Council for this Goal may approve");
    }
  }

  async function record(request: CapabilityApprovalRequest, actor: ApprovalActor, decision: CapabilityApprovalInput["decision"], tier: CapabilityTier, saferAlternative?: string): Promise<CapabilityApproval> {
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
      reason: request.reason,
      consequence: request.consequence,
      ...(saferAlternative === undefined ? {} : { saferAlternative }),
      expiresAt: request.expiresAt,
      repetitionScope: request.repetitionScope,
    });
  }

  async function approve(request: CapabilityApprovalRequest, actor: ApprovalActor): Promise<CapabilityApprovalResult> {
    const classification = classifyRequest(request);
    const tier = effectiveTier(request, classification.tier);
    if (request.headDisagreement && classification.tier === "Department Head" && tier !== "Encore Council") throw new CapabilityApprovalEscalationError();
    if (request.fullAccessMode === "skip_intermediate_approvals" && isIntermediate(tier)) {
      const session = await assertUserActor(request, actor, true);
      return { status: "intermediate_skipped", skippedTier: tier, session: session! };
    }
    await assertActor(request, actor, tier);
    return { status: "approved", approval: await record(request, actor, "approved", tier) };
  }

  async function reject(request: CapabilityApprovalRequest, actor: ApprovalActor): Promise<CapabilityRejectionResult> {
    const classification = classifyRequest(request);
    const tier = effectiveTier(request, classification.tier);
    await assertActor(request, actor, tier);
    const alternative = requireText(request.saferAlternative, "saferAlternative");
    const persisted = await record(request, actor, "safer_alternative", tier, alternative);
    return { status: "rejected", alternative, approval: persisted };
  }

  async function selectFullAccessMode(request: Pick<CapabilityApprovalRequest, "capabilityKind" | "projectId" | "goalId" | "sessionId" | "fullAccessMode">, actor: ApprovalActor): Promise<CapabilitySession> {
    if (actor.kind !== "user" || actor.projectId !== request.projectId || actor.goalId !== request.goalId || actor.active !== true) throw new CapabilityApprovalUnauthorizedError("Only an active Goal-scoped user may select full-access mode");
    if (!(await deps.authorizeActor({ actor, projectId: request.projectId, goalId: request.goalId }))) throw new CapabilityApprovalUnauthorizedError("User authentication or project membership failed");
    const sessionId = requireText(request.sessionId, "sessionId");
    if (request.fullAccessMode === undefined) throw new CapabilityApprovalInvalidRequestError("fullAccessMode is required");
    return ledger.setSession({ sessionId, capabilityKind: request.capabilityKind, projectId: request.projectId, goalId: request.goalId, fullAccessMode: request.fullAccessMode, selectedBy: actor.actorId });
  }

  async function activateExternalCapability(request: ExternalCapabilityActivationRequest, actor: ApprovalActor): Promise<ExternalCapabilityActivation> {
    if (!isExternalCapabilityKind(request.capabilityKind)) throw new CapabilityApprovalInvalidRequestError("capabilityKind must be an external capability");
    if (actor.kind !== "user" || actor.projectId !== request.projectId || actor.goalId !== request.goalId || !actor.active) throw new CapabilityApprovalUnauthorizedError("Only an active Goal-scoped user may activate an external capability");
    if (!(await deps.authorizeActor({ actor, projectId: request.projectId, goalId: request.goalId }))) throw new CapabilityApprovalUnauthorizedError("User authentication or project membership failed");
    if (!(request.expiresAt instanceof Date) || request.expiresAt <= clock()) throw new CapabilityApprovalInvalidRequestError("expiresAt must be in the future");
    const action = "external-capability.activate"; const target = request.capabilityKind; const commandId = `external-capability:${request.capabilityKind}`;
    const approval = await ledger.createApproval({ approvalId: request.activationId, capabilityKind: request.capabilityKind, projectId: request.projectId, goalId: request.goalId, commandId, action, target, policyVersion: 1, controlEpoch: "external-capability-v1", budgetEffectCents: 0, tier: "user", approverId: actor.actorId, decision: "approved", reason: "User explicitly activated this external capability for the Goal.", consequence: "Only the named external capability may be used until expiry, revocation, or repetition exhaustion.", expiresAt: request.expiresAt, repetitionScope: request.repetitionScope });
    const activation = toExternalActivation(approval);
    localExternalActivations.set(externalKey(request.capabilityKind, request.projectId, request.goalId), activation);
    return activation;
  }
  function toExternalActivation(approval: CapabilityApproval): ExternalCapabilityActivation {
    if (!isExternalCapabilityKind(approval.capabilityKind)) throw new CapabilityApprovalInvalidRequestError("Stored approval is not an external capability");
    return { activationId: approval.approvalId, capabilityKind: approval.capabilityKind, projectId: approval.projectId, goalId: approval.goalId, activatedBy: approval.approverId, expiresAt: approval.expiresAt, repetitionScope: approval.repetitionScope as ExternalCapabilityRepetitionScope, revokedAt: approval.revokedAt, createdAt: approval.createdAt, repetitionRemainingCount: approval.repetitionRemainingCount, repetitionRemainingBudgetCents: approval.repetitionRemainingBudgetCents, repetitionExpiresAt: approval.repetitionExpiresAt };
  }
  async function findExternalActivation(reference: ExternalCapabilityReference): Promise<ExternalCapabilityActivation | undefined> {
    if (!isExternalCapabilityKind(reference.capabilityKind)) return undefined;
    if (ledger.findApproval) {
      const approval = await ledger.findApproval(reference.capabilityKind, reference.projectId, reference.goalId, `external-capability:${reference.capabilityKind}`);
      return approval !== undefined && approval.capabilityKind === reference.capabilityKind && approval.projectId === reference.projectId && approval.goalId === reference.goalId ? toExternalActivation(approval) : undefined;
    }
    return localExternalActivations.get(externalKey(reference.capabilityKind, reference.projectId, reference.goalId));
  }
  async function isExternalCapabilityActive(reference: ExternalCapabilityReference): Promise<boolean> {
    const activation = await findExternalActivation(reference);
    if (activation === undefined || activation.revokedAt !== null || activation.expiresAt <= clock()) return false;
    if (activation.repetitionExpiresAt !== null && activation.repetitionExpiresAt <= clock()) return false;
    if (activation.repetitionRemainingCount !== null && activation.repetitionRemainingCount <= 0) return false;
    if (activation.repetitionRemainingBudgetCents !== null && activation.repetitionRemainingBudgetCents <= 0) return false;
    return true;
  }
  async function revokeExternalCapability(reference: ExternalCapabilityReference, actor: ApprovalActor): Promise<void> {
    if (!isExternalCapabilityKind(reference.capabilityKind)) throw new CapabilityApprovalInvalidRequestError("capabilityKind must be an external capability");
    if (actor.kind !== "user" || actor.projectId !== reference.projectId || actor.goalId !== reference.goalId || !actor.active) throw new CapabilityApprovalUnauthorizedError("Only an active Goal-scoped user may revoke an external capability");
    if (!(await deps.authorizeActor({ actor, projectId: reference.projectId, goalId: reference.goalId }))) throw new CapabilityApprovalUnauthorizedError("User authentication or project membership failed");
    const activation = await findExternalActivation(reference);
    if (activation === undefined) throw new ExternalCapabilityDeniedError("not_activated");
    if (ledger.revokeApproval) await ledger.revokeApproval(activation.activationId, actor.actorId);
    localExternalActivations.set(externalKey(reference.capabilityKind, reference.projectId, reference.goalId), { ...activation, revokedAt: clock() });
  }
  async function consumeExternalCapability(request: ExternalCapabilityConsumptionRequest): Promise<CapabilityConsumptionResult> {
    const activation = await findExternalActivation(request);
    if (activation === undefined) throw new ExternalCapabilityDeniedError("not_activated");
    if (activation.revokedAt !== null) throw new ExternalCapabilityDeniedError("revoked");
    if (activation.expiresAt <= clock() || (activation.repetitionExpiresAt !== null && activation.repetitionExpiresAt <= clock())) throw new ExternalCapabilityDeniedError("expired");
    if ((activation.repetitionRemainingCount !== null && activation.repetitionRemainingCount <= 0) || (activation.repetitionRemainingBudgetCents !== null && activation.repetitionRemainingBudgetCents < (request.budgetEffectCents ?? 0))) throw new ExternalCapabilityDeniedError("repetition_exhausted");
    const result = await ledger.consumeApproval({ approvalId: activation.activationId, capabilityKind: request.capabilityKind, projectId: request.projectId, goalId: request.goalId, commandId: request.commandId, action: "external-capability.activate", target: request.capabilityKind, policyVersion: 1, controlEpoch: "external-capability-v1", budgetEffectCents: request.budgetEffectCents ?? 0 });
    if (result.consumed) {
      const current = localExternalActivations.get(externalKey(request.capabilityKind, request.projectId, request.goalId));
      if (current !== undefined) localExternalActivations.set(externalKey(request.capabilityKind, request.projectId, request.goalId), { ...current, repetitionRemainingCount: result.remainingCount, repetitionRemainingBudgetCents: result.remainingBudgetCents });
    }
    return result;
  }

  return {
    approve, reject, selectFullAccessMode,
    consume: (input) => ledger.consumeApproval(input),
    activateExternalCapability, isExternalCapabilityActive, revokeExternalCapability, consumeExternalCapability,
  };
}
