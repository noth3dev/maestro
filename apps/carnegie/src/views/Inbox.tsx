import React, { useEffect, useState } from "react";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { loadInbox, approveInboxItem, denyInboxItem, discussWithConcertmaster } from "../lib/inbox-data.js";
import type { InboxRead } from "@maestro/api-client";
import type { ViewName } from "../views.js";

function expiry(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

export function Inbox({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { detail, loading: detailLoading, error: detailError } = useGoalDetail();
  const [inbox, setInbox] = useState<InboxRead | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [discussionId, setDiscussionId] = useState<string | undefined>(undefined);
  const [discussionText, setDiscussionText] = useState("");

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

  const approve = async (item: InboxRead["items"][number]) => {
    if (busyId !== undefined) return;
    setBusyId(item.decisionId);
    setError(undefined);
    try {
      await approveInboxItem(window.maestro.api, item, expiry(), item.commandId);
      window.dispatchEvent(new Event("maestro:inbox-updated"));
      refresh();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not approve action");
    } finally { setBusyId(undefined); }
  };

  const deny = async (item: InboxRead["items"][number]) => {
    if (busyId !== undefined) return;
    setBusyId(item.decisionId);
    setError(undefined);
    try {
      await denyInboxItem(window.maestro.api, item, item.commandId);
      window.dispatchEvent(new Event("maestro:inbox-updated"));
      refresh();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not deny action");
    } finally { setBusyId(undefined); }
  };

  const discuss = async (item: InboxRead["items"][number]) => {
    if (busyId !== undefined || config === undefined || discussionText.trim() === "") return;
    setBusyId(item.decisionId);
    setError(undefined);
    try {
      await discussWithConcertmaster(window.maestro.api, { projectId: config.projectId, goalId: item.goalId, text: discussionText.trim() });
      setDiscussionId(undefined);
      setDiscussionText("");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not discuss with Concertmaster");
    } finally { setBusyId(undefined); }
  };

  if (config === undefined) return <EmptyState />;
  const displayError = error ?? detailError;
  return (
    <div className="inbox-main">
      <div className="dash-head" style={{ padding: "20px 20px 0" }}><div className="dash-title">inbox</div></div>
      <div className="dash-sub" style={{ padding: "0 20px 14px" }}>pending approvals and certifications across visible Goals</div>
      <div className="inbox-list">
        {loading && <p style={{ padding: "0 20px" }}>loading…</p>}
        {displayError !== undefined && <div className="alert alert-warning" style={{ margin: "0 20px" }}>{displayError}</div>}
        {!loading && error === undefined && inbox !== undefined && inbox.items.length === 0 && <p style={{ padding: "0 20px" }}>No pending approvals.</p>}
        {inbox?.items.map((item) => (
          <div key={item.decisionId} className="inbox-item pending">
            <div className="inbox-icon" style={{ background: "var(--ochre-bg)", color: "var(--ochre-text)" }}><Icon name="shield" /></div>
            <div className="inbox-body">
              <div className="inbox-title">{item.action} · {item.target}</div>
              <div className="inbox-sub">Goal {item.goalId} · {item.reason}</div>
              <div className="inbox-actions">
                <button className="inbox-link" disabled={busyId !== undefined} onClick={() => void approve(item)}><Icon name="check" /> {busyId === item.decisionId ? "approving…" : "approve and run"}</button>
                <button className="inbox-link" disabled={busyId !== undefined} onClick={() => void deny(item)}><Icon name="x" /> deny</button>
                <button className="inbox-link" data-discuss-path="conversation" disabled={busyId !== undefined} onClick={() => setDiscussionId(item.decisionId)}><Icon name="message-circle" /> Discuss with Concertmaster</button>
              </div>
              {discussionId === item.decisionId && <div className="inbox-discuss">
                <label className="sr-only" htmlFor={`inbox-discuss-${item.decisionId}`}>Discuss with Concertmaster</label>
                <textarea id={`inbox-discuss-${item.decisionId}`} value={discussionText} onChange={(event) => setDiscussionText(event.target.value)} placeholder="Ask about this decision" />
                <button className="btn btn-sm" type="button" disabled={busyId !== undefined || discussionText.trim() === ""} onClick={() => void discuss(item)}>send</button>
              </div>}
            </div>
          </div>
        ))}
        {detailLoading && <p style={{ padding: "0 20px" }}>loading certifications…</p>}
        {detail?.certifications.map((certification) => (
          <div key={certification.certificationId} className="inbox-item info">
            <div className="inbox-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="check" /></div>
            <div className="inbox-body">
              <div className="inbox-title">{certification.kind} · {certification.verdict} · {certification.producingDepartment}</div>
              <div className="inbox-sub">commit {certification.integratedCommitSha.slice(0, 12)}… · certified by {certification.certifiedByDepartment}</div>
              <div className="inbox-actions"><button className="inbox-link" onClick={() => onNavigate("git")}><Icon name="external-link" /> view in Git</button></div>
            </div>
          </div>
        ))}
        {detail === undefined && !detailLoading && detailError === undefined && <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to see its real certifications here." />}
      </div>
    </div>
  );
}
