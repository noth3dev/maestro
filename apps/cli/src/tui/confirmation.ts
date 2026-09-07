export interface CriticalActionSummary {
  action: string;
  target: string;
  goalId?: string;
  effect: string;
  expiresAt: string;
}

export type ConfirmationResult = "approved" | "cancelled";
export type ConfirmationPrompt = (summary: CriticalActionSummary) => Promise<ConfirmationResult>;

export async function confirmCriticalAction(summary: CriticalActionSummary, prompt: ConfirmationPrompt): Promise<ConfirmationResult> {
  return prompt(summary);
}
