export type ActionClassification = "ordinary" | "critical" | "forbidden" | "ambiguous";

export interface ActionRequest {
  actorId: string;
  goalId: string;
  action: string;
  target: string;
  classification: ActionClassification;
  policyVersion: number;
}

export interface AuthorityRecord {
  kind: "grant" | "approval";
  actorId: string;
  goalId: string;
  action: string;
  target: string;
  policyVersion: number;
  expiresAt: Date;
}

export type AuthorityDecision = {
  effect: "allow" | "deny" | "require_approval";
  reason: string;
};

function matches(request: ActionRequest, record: AuthorityRecord, now: Date): boolean {
  return (
    record.actorId === request.actorId &&
    record.goalId === request.goalId &&
    record.action === request.action &&
    record.target === request.target &&
    record.policyVersion === request.policyVersion &&
    record.expiresAt > now
  );
}

export function evaluateAction(
  request: ActionRequest,
  records: readonly AuthorityRecord[],
  now: Date,
): AuthorityDecision {
  if (request.classification === "forbidden" || request.classification === "ambiguous") {
    return { effect: "deny", reason: request.classification };
  }

  const requiredKind = request.classification === "critical" ? "approval" : "grant";
  const authorized = records.some(
    (record) => record.kind === requiredKind && matches(request, record, now),
  );

  if (authorized) {
    return {
      effect: "allow",
      reason: requiredKind === "approval" ? "exact_approval" : "exact_grant",
    };
  }

  return request.classification === "critical"
    ? { effect: "require_approval", reason: "critical_action" }
    : { effect: "deny", reason: "no_grant" };
}

export async function runAuthorized<T>(
  request: ActionRequest,
  records: readonly AuthorityRecord[],
  now: Date,
  effect: () => Promise<T>,
): Promise<T> {
  const decision = evaluateAction(request, records, now);
  if (decision.effect !== "allow") {
    throw new Error(`Action not allowed: ${decision.reason}`);
  }
  return effect();
}
