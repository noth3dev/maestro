export interface CriticalActionSummary {
  action: string;
  target: string;
  goalId?: string;
  effect: string;
  expiresAt: string;
}

export type ApprovalDialogTier = "automatic progress" | "Department Head" | "Encore Council" | "user";
export type ApprovalDialogEffectClassification = "ordinary" | "critical" | "forbidden" | "ambiguous";
export type ApprovalDialogTierTrigger = "effect" | "pressure";
export type ApprovalDialogRepetitionScope = "once" | "bounded_count" | "bounded_time" | "bounded_budget" | "session";
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
  effects: readonly ApprovalDialogEffect[];
  repetitionScope: ApprovalDialogRepetitionScope;
  saferAlternative: string;
  fullAccessMode?: "retain_intermediate_approvals" | "skip_intermediate_approvals";
}
export type ApprovalDialogSummary = CriticalActionSummary & Partial<ApprovalDialogDetails>;

export type ConfirmationResult = "approved" | "cancelled";
export type ConfirmationPrompt = (summary: CriticalActionSummary) => Promise<ConfirmationResult>;

export async function confirmCriticalAction(summary: CriticalActionSummary, prompt: ConfirmationPrompt): Promise<ConfirmationResult> {
  return prompt(summary);
}
