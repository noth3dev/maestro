export type ActionClassification = "ordinary" | "critical" | "forbidden" | "ambiguous";

export interface ActionRequest {
  commandId: string;
  actorId: string;
  goalId: string;
  action: string;
  target: string;
  policyVersion: number;
  budgetEffectCents: number;
}

export interface AuthorityRecord {
  recordId: string;
  kind: "grant" | "approval";
  commandId: string | null;
  actorId: string;
  goalId: string;
  action: string;
  target: string;
  policyVersion: number;
  expiresAt: Date;
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
    case "git.local.commit":
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
    record.actorId === request.actorId &&
    record.goalId === request.goalId &&
    record.action === request.action &&
    record.target === request.target &&
    record.policyVersion === request.policyVersion
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
