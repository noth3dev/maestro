import type { TaskContract } from "@maestro/contracts";

import { extractTaskContractDraft } from "./goal-less-intake.js";

export interface DraftPresentationOptions {
  content: string;
  goalId: string | undefined;
  current: TaskContract | undefined;
  renderedIdentity: string | undefined;
}

export interface DraftPresentation {
  draft: TaskContract;
  identity: string;
  shouldRender: boolean;
}

export function draftForPresentation(options: DraftPresentationOptions): DraftPresentation | undefined {
  if (options.goalId !== undefined) return undefined;
  const draft = extractTaskContractDraft(options.content) ?? options.current;
  if (draft === undefined) return undefined;
  const identity = `${draft.contractId}:${draft.version}:${draft.contentHash}`;
  return { draft, identity, shouldRender: options.renderedIdentity !== identity };
}
