import { CreateConversationInputSchema, TaskContractSchema, type CreateConversationInput, type TaskContract } from "@maestro/contracts";

export type GoalLessDraftDecision = "decline" | "revise";
export type GoalLessDraftState = {
  draft: TaskContract;
  status: "review" | "declined" | "revising";
};

/** Build the same conversation input for both TUI modes without inventing a Goal. */
export function buildConversationInput(projectId: string, goalId: string | undefined, model: string): CreateConversationInput {
  return CreateConversationInputSchema.parse({ projectId, goalId: goalId ?? null, model });
}

/**
 * Extract a server-created contract from an assistant response. The model may
 * wrap JSON in prose or a markdown fence, so only schema-valid candidates are
 * accepted and untrusted prose can never be shown as a contract.
 */
export function extractTaskContractDraft(content: string): TaskContract | undefined {
  const candidates = [content];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(fenced)) if (match[1] !== undefined) candidates.push(match[1]);
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(content.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      const result = TaskContractSchema.safeParse(parsed);
      if (result.success && result.data.launchState === "awaiting_confirmation") return result.data;
    } catch {
      // Assistant prose is not a draft. Continue looking for a valid payload.
    }
  }
  return undefined;
}

/** Render the complete server response before offering either approval action. */
export function renderTaskContractDraft(contract: TaskContract): string[] {
  const payload = JSON.stringify(contract, null, 2);
  return [
    `Task Contract draft · ${contract.launchState} · v${contract.version}`,
    "Review the complete draft below. No execution has started.",
    "",
    "```json",
    payload,
    "```",
    "",
    `To approve this exact draft, explicitly run: /task-contract confirm --contract-id ${contract.contractId} --version ${contract.version} --content-hash ${contract.contentHash}`,
    `To launch only after confirmation, explicitly run: /task-contract launch --contract-id ${contract.contractId}`,
    "Decline or describe revisions in your next message to keep this conversation and draft resumable.",
  ];
}

/** Decline/revise changes review status only; it never drops the durable draft. */
export function retainDraftAfterDecision(state: GoalLessDraftState, decision: GoalLessDraftDecision): GoalLessDraftState {
  return { draft: state.draft, status: decision === "decline" ? "declined" : "revising" };
}
