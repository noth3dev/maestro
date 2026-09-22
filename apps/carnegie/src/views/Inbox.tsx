import React, { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { useGoals } from "../goals.js";
import type { InboxRead } from "@maestro/api-client";
import type { CapabilitySession } from "@maestro/contracts";
import type { ViewName } from "../views.js";
import { Approvals, type WorkerDecisionProjection } from "./Approvals.js";
import { loadInbox, approveInboxItem, denyInboxItem, discussWithConcertmaster } from "../lib/inbox-data.js";
import { groupInboxItems, requestCriticalAction, selectFullAccessMode, type ApprovalDiscussionProjection } from "../lib/approval-data.js";

export function Inbox({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const { detail, loading: detailLoading, error: detailError } = useGoalDetail();
  const [inbox, setInbox] = useState<InboxRead | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [discussion, setDiscussion] = useState<ApprovalDiscussionProjection[]>([]);
  const [fullAccessSession, setFullAccessSession] = useState<CapabilitySession | undefined>(undefined);

  const refresh = () => {
    if (config === undefined) return;
    setLoading(true);
    setError(undefined);
    void loadInbox(window.maestro.api, config.projectId)
      .then(setInbox)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load inbox"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [config]);

  const approve = async (item: InboxRead["items"][number], expiresAt: string) => {
    if (config === undefined) return;
    setError(undefined);
    await approveInboxItem(window.maestro.api, item, expiresAt);
    window.dispatchEvent(new Event("maestro:inbox-updated"));
    refresh();
  };

  const deny = async (item: InboxRead["items"][number]) => {
    setError(undefined);
    await denyInboxItem(window.maestro.api, item);
    window.dispatchEvent(new Event("maestro:inbox-updated"));
    refresh();
  };

  const discuss = async (item: InboxRead["items"][number], text: string) => {
    if (config === undefined) return;
    setError(undefined);
    const previous = discussion.find((entry) => entry.decisionId === item.decisionId);
    const response = await discussWithConcertmaster(window.maestro.api, {
      projectId: config.projectId,
      goalId: item.goalId,
      text,
      ...(previous === undefined ? {} : { conversationId: previous.conversationId }),
    });
    const next: ApprovalDiscussionProjection = {
      decisionId: item.decisionId,
      conversationId: response.conversation.conversationId,
      projectId: response.conversation.projectId,
      goalId: response.conversation.goalId ?? item.goalId,
      response: response.turn.content,
    };
    setDiscussion((current) => [...current.filter((entry) => entry.decisionId !== item.decisionId), next]);
    // Do not refresh the inbox here: the pending approval must remain visible while discussion is open.
  };

  const workerDecisions: WorkerDecisionProjection[] = detail?.certifications.map((certification) => ({
    id: certification.certificationId,
    title: `${certification.kind} · ${certification.verdict} · ${certification.producingDepartment}`,
    detail: `Worker ${certification.workerId} · commit ${certification.integratedCommitSha.slice(0, 12)}… · certified by ${certification.certifiedByDepartment}`,
    onReview: () => onNavigate("git"),
  })) ?? [];

  if (config === undefined) return <EmptyState />;
  const groups = groupInboxItems(inbox?.items ?? [], workerDecisions, discussion);
  const displayError = error ?? detailError;
  return (
    <div className="inbox-main">
      <header className="workspace-view-head">
        <div className="dash-kicker">operations</div>
        <h1 className="dash-title">inbox</h1>
        <p className="dash-sub">Pending approvals across visible Goals; certifications for the selected Goal. Approvals, worker decisions, and scoped Concertmaster discussions come from durable project state.</p>
      </header>
      <div className="inbox-list workspace-view-body">
        {loading && <p>loading…</p>}
        {displayError !== undefined && <div className="alert alert-warning" role="alert">{displayError}</div>}
        {detailLoading && <p>loading worker decisions…</p>}
        <Approvals
          items={groups.criticalActions}
          workerDecisions={groups.workerDecisions}
          discussions={groups.discussions}
          {...(selectedGoalId === undefined ? {} : { selectedGoalId })}
          projectId={config.projectId}
          {...(fullAccessSession === undefined ? {} : { fullAccessSession })}
          onApprove={approve}
          onDeny={deny}
          onDiscuss={discuss}
          onRequest={async (input) => {
            await requestCriticalAction(window.maestro.api, input);
            refresh();
          }}
          onSelectFullAccess={async (input) => {
            const session = await selectFullAccessMode(window.maestro.api, input, true);
            setFullAccessSession(session);
          }}
        />
      </div>
    </div>
  );
}
