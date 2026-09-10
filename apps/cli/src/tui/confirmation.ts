export type ApprovalDialogTier = "automatic progress" | "Department Head" | "Encore Council" | "user";

export interface CriticalActionSummary {
  action: string;
  target: string;
  goalId?: string;
  /** Durable command identity used to correlate the confirmation with activity. */
  identity?: string;
  /** Actor and tier are explicit display/audit fields; neither may be inferred. */
  actor?: string;
  tier?: ApprovalDialogTier;
  effect: string;
  expiresAt: string;
}
export type ApprovalDialogEffectClassification = "ordinary" | "critical" | "forbidden" | "ambiguous";
export type ApprovalDialogTierTrigger = "effect" | "pressure";
export type ApprovalDialogRepetitionScope = "once" | "bounded_count" | "bounded_time" | "bounded_budget" | "session";

export const APPROVAL_DIALOG_SCOPE_OPTIONS = ["once", "bounded_count", "session"] as const;

export function nextApprovalDialogScope(current: ApprovalDialogRepetitionScope, direction: 1 | -1): ApprovalDialogRepetitionScope {
  const index = APPROVAL_DIALOG_SCOPE_OPTIONS.indexOf(current as (typeof APPROVAL_DIALOG_SCOPE_OPTIONS)[number]);
  const start = index === -1 ? 0 : index;
  return APPROVAL_DIALOG_SCOPE_OPTIONS[(start + direction + APPROVAL_DIALOG_SCOPE_OPTIONS.length) % APPROVAL_DIALOG_SCOPE_OPTIONS.length]!;
}
export interface ApprovalDialogEffect {
  classification: ApprovalDialogEffectClassification;
  action: string;
  target: string;
  setsTier?: boolean;
}
export interface ApprovalDialogDetails {
  tier: ApprovalDialogTier;
  tierTrigger: ApprovalDialogTierTrigger;
  pressure?: number;
  pressureBand?: "low" | "medium" | "high" | "critical";
  pressureTier?: ApprovalDialogTier;
  effects: readonly ApprovalDialogEffect[];
  repetitionScope: ApprovalDialogRepetitionScope;
  saferAlternative: string;
  fullAccessMode?: "retain_intermediate_approvals" | "skip_intermediate_approvals";
}
export type ApprovalDialogSummary = CriticalActionSummary & Partial<ApprovalDialogDetails>;

export interface ConfirmationApproval {
  readonly decision: "approved";
  readonly repetitionScope: ApprovalDialogRepetitionScope;
}

export type ConfirmationResult = "approved" | "cancelled" | ConfirmationApproval;
export type ConfirmationPrompt = (summary: ApprovalDialogSummary) => Promise<ConfirmationResult>;

export function isApprovalDialogBound(summary: ApprovalDialogSummary): boolean {
  const identity = summary.identity?.trim();
  const actor = summary.actor?.trim();
  return identity !== undefined && identity !== "" && actor !== undefined && actor !== ""
    && (summary.tier === "automatic progress" || summary.tier === "Department Head" || summary.tier === "Encore Council" || summary.tier === "user");
}

export async function confirmCriticalAction(summary: ApprovalDialogSummary, prompt: ConfirmationPrompt): Promise<ConfirmationResult> {
  if (!isApprovalDialogBound(summary)) return "cancelled";
  return prompt(summary);
}
