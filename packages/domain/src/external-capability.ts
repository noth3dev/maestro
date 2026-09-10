export const EXTERNAL_CAPABILITY_KINDS = ["browser", "device", "external-service", "deployment"] as const;
export type ExternalCapabilityKind = (typeof EXTERNAL_CAPABILITY_KINDS)[number];

export type ExternalCapabilityRepetitionScope =
  | { readonly kind: "one_execution" }
  | { readonly kind: "bounded_count"; readonly count: number }
  | { readonly kind: "bounded_time"; readonly expiresAt: Date }
  | { readonly kind: "bounded_budget"; readonly budgetCents: number };

export interface ExternalCapabilityActivation {
  readonly activationId: string;
  readonly capabilityKind: ExternalCapabilityKind;
  readonly projectId: string;
  readonly goalId: string;
  readonly activatedBy: string;
  readonly expiresAt: Date;
  readonly repetitionScope: ExternalCapabilityRepetitionScope;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly repetitionRemainingCount: number | null;
  readonly repetitionRemainingBudgetCents: number | null;
  readonly repetitionExpiresAt: Date | null;
}

export function isExternalCapabilityKind(value: string): value is ExternalCapabilityKind {
  return (EXTERNAL_CAPABILITY_KINDS as readonly string[]).includes(value);
}

export function assertExternalCapabilityKind(value: string): ExternalCapabilityKind {
  if (!isExternalCapabilityKind(value)) throw new Error(`Unsupported external capability kind: ${value}`);
  return value;
}
