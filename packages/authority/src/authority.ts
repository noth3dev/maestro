export type ActionClassification = "ordinary" | "critical" | "forbidden" | "ambiguous";

export interface ActionRequest {
  commandId: string;
  projectId: string;
  actorId: string;
  goalId: string;
  action: string;
  target: string;
  policyVersion: number;
  budgetEffectCents: number;
  /** Monotonic Goal control version captured before effect execution. */
  controlEpoch: string;
}

export interface AuthorityRecord {
  recordId: string;
  kind: "grant" | "approval";
  commandId: string | null;
  projectId: string;
  actorId: string;
  goalId: string;
  action: string;
  target: string;
  policyVersion: number;
  budgetEffectCents: number;
  expiresAt: Date;
  issuedAt?: Date;
  revokedAt?: Date;
}

export type AuthorityDecision = {
  effect: "allow" | "deny" | "require_approval";
  reason: string;
  classification: ActionClassification;
  request: ActionRequest;
  recordId?: string;
  expiresAt?: Date;
};

function classifyAction(action: string): ActionClassification {
  switch (action) {
    case "project.file.edit":
    case "project.test.run":
    case "git.local.branch.create":
    case "git.local.branch.advance":
    case "git.local.commit":
    case "git.local.revision.read":
    case "git.local.worktree.create":
    case "git.local.worktree.remove":
    case "browser.navigate":
    case "browser.click":
    case "browser.fill":
    case "browser.get_text":
    case "browser.screenshot":
      return "ordinary";
    case "git.remote.push":
    case "deployment.release":
    case "external.send":
    case "permanent.delete":
    case "payment.spend":
    case "authority.change":
    case "external.connect":
      return "critical";
    case "system.policy.bypass":
      return "forbidden";
    default:
      return "ambiguous";
  }
}

function hasMatchingScope(
  request: ActionRequest,
  record: AuthorityRecord,
  kind: AuthorityRecord["kind"],
): boolean {
  const commandMatches =
    kind === "approval"
      ? record.commandId === request.commandId
      : record.commandId === null || record.commandId === request.commandId;
  return (
    record.kind === kind &&
    commandMatches &&
    record.projectId === request.projectId &&
    record.actorId === request.actorId &&
    record.goalId === request.goalId &&
    record.action === request.action &&
    record.target === request.target &&
    record.policyVersion === request.policyVersion &&
    record.budgetEffectCents === request.budgetEffectCents
  );
}

export function evaluateAction(
  request: ActionRequest,
  records: readonly AuthorityRecord[],
  now: Date,
): AuthorityDecision {
  const classification = classifyAction(request.action);
  const base = { classification, request };

  if (classification === "forbidden") {
    return { ...base, effect: "deny", reason: "forbidden" };
  }
  if (classification === "ambiguous") {
    return { ...base, effect: "deny", reason: "ambiguous_action" };
  }

  const kind = classification === "critical" ? "approval" : "grant";
  const candidates = records.filter((record) =>
    hasMatchingScope(request, record, kind),
  );
  const active = candidates.find(
    (record) =>
      record.expiresAt > now &&
      (record.revokedAt === undefined || record.revokedAt > now),
  );
  if (active) {
    return {
      ...base,
      effect: "allow",
      reason: kind === "approval" ? "exact_approval" : "exact_grant",
      recordId: active.recordId,
      expiresAt: active.expiresAt,
    };
  }

  const prefix = kind === "approval" ? "approval" : "grant";
  const reason = candidates.some(
    (record) => record.revokedAt !== undefined && record.revokedAt <= now,
  )
    ? `revoked_${prefix}`
    : candidates.some((record) => record.expiresAt <= now)
      ? `expired_${prefix}`
      : classification === "critical"
        ? "critical_action"
        : "no_grant";

  return {
    ...base,
    effect: classification === "critical" ? "require_approval" : "deny",
    reason,
  };
}


export class AuthorityClaimConflictError extends Error {
  constructor() {
    super("Authority effect claim identity was reused with different scope");
    this.name = "AuthorityClaimConflictError";
  }
}

export interface AuthorityDecisionAudit {
  decision: AuthorityDecision;
  decidedAt: Date;
}

/** Durable storage boundary. The authority package has no database or provider dependency. */
export type ControlRecheck =
  | { effect: "allow" }
  | {
      effect: "deny";
      reason: "emergency_stop" | "stale_control_epoch" | "pause_requested" | "paused" | "stopping" | "stopped" | "goal_not_found" | "goal_not_executable";
    };

export interface AuthorityRepository {
  load(request: ActionRequest): Promise<readonly AuthorityRecord[]>;
  appendDecision(audit: AuthorityDecisionAudit): Promise<void>;
  /** Last durable control check immediately before an effect callback. */
  recheckControl(request: ActionRequest): Promise<ControlRecheck>;
  /**
   * Atomically claims a command before invoking its external effect. Durable
   * repositories use this to make retries at-most-once; in-memory/test
   * repositories may omit it and retain the original gateway semantics.
   */
  claimEffect?(request: ActionRequest): Promise<boolean>;
}

/**
 * The only gateway which may invoke an externally supplied effect. It first
 * loads durable authority, evaluates it, and appends the decision. Any failure
 * in that sequence denies without calling the effect.
 */
export class AuthorizedEffectExecutor {
  constructor(
    private readonly repository: AuthorityRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
    let decision: AuthorityDecision;
    try {
      const records = await this.repository.load(request);
      decision = evaluateAction(request, records, this.clock());
    } catch {
      decision = unavailableDecision(request);
      try {
        await this.repository.appendDecision({ decision, decidedAt: this.clock() });
      } catch {
        // A failed audit write must still fail closed.
      }
      return decision;
    }

    // A Goal control latch (emergency stop / superseded epoch) dominates the
    // grant/approval evaluation above: it must block a stale-epoch or already
    // emergency-stopped Goal even if a still-active grant would otherwise allow.
    let control: ControlRecheck;
    try {
      control = await this.repository.recheckControl(request);
    } catch {
      return unavailableDecision(request);
    }
    const final: AuthorityDecision =
      control.effect === "deny" ? { ...decision, effect: "deny", reason: control.reason } : decision;

    try {
      await this.repository.appendDecision({ decision: final, decidedAt: this.clock() });
    } catch {
      return unavailableDecision(request);
    }

    if (final.effect !== "allow") return final;

    // A provider effect cannot be rolled back with the surrounding audit
    // write. Claim the command durably first so a lost HTTP response or
    // client retry can never invoke the same external effect twice. A
    // repository that does not implement the optional claim keeps the pure
    // gateway behavior used by lightweight unit tests.
    if (this.repository.claimEffect !== undefined) {
      let claimed: boolean;
      try {
        claimed = await this.repository.claimEffect(request);
      } catch (error) {
        if (error instanceof AuthorityClaimConflictError) return { ...final, effect: "deny", reason: "command_id_reused" };
        return unavailableDecision(request);
      }
      if (!claimed) return { ...final, reason: "already_executed" };
    }

    await effect();
    return final;
  }
}

function unavailableDecision(request: ActionRequest): AuthorityDecision {
  return {
    effect: "deny",
    reason: "authority_unavailable",
    classification: "ambiguous",
    request,
  };
}
