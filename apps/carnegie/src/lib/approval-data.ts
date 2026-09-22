import type { ApiClient, InboxRead } from "@maestro/api-client";
import type { CapabilitySession, CapabilitySessionSelectionInput, CriticalActionInput, CriticalActionResult, FullAccessMode } from "@maestro/contracts";
import { FullAccessModeSchema, UuidSchema } from "@maestro/contracts";
import { approveInboxItem, denyInboxItem, discussWithConcertmaster, type InboxDiscussionApi } from "./inbox-data.js";
import { newCommandId } from "./command-id.js";

export type ApprovalApi = Pick<
  ApiClient,
  "listInbox" | "requestCriticalAction" | "approveAndRunCriticalAction" | "denyCriticalAction" | "selectFullAccessMode" | "createConversation" | "sendConversationTurn"
>;

export type ApprovalItem = InboxRead["items"][number];

export interface ApprovalDiscussionProjection {
  readonly decisionId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly response: string;
}

export interface ApprovalGroups {
  readonly criticalActions: readonly ApprovalItem[];
  readonly workerDecisions: readonly { readonly id: string; readonly title: string; readonly detail: string; readonly onReview?: () => void }[];
  readonly discussions: readonly ApprovalDiscussionProjection[];
}

/**
 * The inbox contract currently contains pending critical actions only. Other
 * groups must be supplied by their own durable read; this function never
 * invents worker or discussion records.
 */
export function groupInboxItems(
  items: readonly ApprovalItem[],
  workerDecisions: readonly ApprovalGroups["workerDecisions"][number][] = [],
  discussions: readonly ApprovalDiscussionProjection[] = [],
): ApprovalGroups {
  return { criticalActions: items, workerDecisions, discussions };
}

export async function requestCriticalAction(
  api: Pick<ApiClient, "requestCriticalAction">,
  input: CriticalActionInput & { readonly goalId: string },
  commandId = newCommandId(),
): Promise<CriticalActionResult> {
  const { goalId, ...request } = input;
  return api.requestCriticalAction(goalId, request, commandId);
}

export function approvePendingInboxItem(
  api: Pick<ApiClient, "approveAndRunCriticalAction">,
  item: ApprovalItem,
  expiresAt: string,
  commandId = item.commandId,
): ReturnType<typeof approveInboxItem> {
  return approveInboxItem(api, item, expiresAt, commandId);
}

export function denyPendingInboxItem(
  api: Pick<ApiClient, "denyCriticalAction">,
  item: ApprovalItem,
  commandId = item.commandId,
): ReturnType<typeof denyInboxItem> {
  return denyInboxItem(api, item, commandId);
}

export interface FullAccessSelection extends Omit<CapabilitySessionSelectionInput, "goalId"> {
  readonly goalId: string;
}

/** The server is the only authority that turns a selected mode into a session. */
export async function selectFullAccessMode(
  api: Pick<ApiClient, "selectFullAccessMode">,
  input: FullAccessSelection,
  explicitlyConfirmed: boolean,
): Promise<CapabilitySession> {
  if (!explicitlyConfirmed) throw new Error("Full-access mode requires explicit confirmation");
  const sessionId = UuidSchema.parse(input.sessionId);
  const fullAccessMode: FullAccessMode = FullAccessModeSchema.parse(input.fullAccessMode);
  return api.selectFullAccessMode(input.goalId, {
    projectId: input.projectId,
    capabilityKind: input.capabilityKind,
    sessionId,
    fullAccessMode,
  });
}

export async function discussApproval(
  api: InboxDiscussionApi,
  input: Parameters<typeof discussWithConcertmaster>[1],
): ReturnType<typeof discussWithConcertmaster> {
  return discussWithConcertmaster(api, input);
}
