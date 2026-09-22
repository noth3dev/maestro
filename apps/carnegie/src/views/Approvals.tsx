import React, { useState } from "react";
import type { FormEvent } from "react";
import type { InboxRead } from "@maestro/api-client";
import type { CapabilitySession, CriticalActionInput, FullAccessMode } from "@maestro/contracts";
import { Icon } from "../icons.js";
import type { ApprovalDiscussionProjection, ApprovalItem } from "../lib/approval-data.js";

export interface WorkerDecisionProjection {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly onReview?: () => void;
}

export interface ApprovalsProps {
  readonly items: readonly ApprovalItem[];
  readonly workerDecisions?: readonly WorkerDecisionProjection[];
  readonly discussions?: readonly ApprovalDiscussionProjection[];
  readonly selectedGoalId?: string;
  readonly projectId?: string;
  readonly fullAccessSession?: CapabilitySession;
  readonly onApprove: (item: InboxRead["items"][number], expiresAt: string) => void | Promise<void>;
  readonly onDeny: (item: InboxRead["items"][number]) => void | Promise<void>;
  readonly onDiscuss: (item: InboxRead["items"][number], text: string) => void | Promise<void>;
  readonly onRequest?: (input: CriticalActionInput & { readonly goalId: string }) => void | Promise<void>;
  readonly onSelectFullAccess?: (input: {
    readonly goalId: string;
    readonly projectId: string;
    readonly capabilityKind: string;
    readonly sessionId: string;
    readonly fullAccessMode: FullAccessMode;
  }) => void | Promise<void>;
}

export function Approvals({
  items,
  workerDecisions = [],
  discussions = [],
  selectedGoalId,
  projectId,
  fullAccessSession,
  onApprove,
  onDeny,
  onDiscuss,
  onRequest,
  onSelectFullAccess,
}: ApprovalsProps) {
  const [expiryByDecision, setExpiryByDecision] = useState<Record<string, string>>({});
  const [discussionByDecision, setDiscussionByDecision] = useState<Record<string, string>>({});
  const [request, setRequest] = useState({ action: "", target: "", policyVersion: "0", budgetEffectCents: "0" });
  const [capabilityKind, setCapabilityKind] = useState("ipython");
  const [sessionId, setSessionId] = useState("");
  const [fullAccessMode, setFullAccessMode] = useState<FullAccessMode>("retain_intermediate_approvals");
  const [fullAccessConfirmed, setFullAccessConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = async (key: string, action: () => void | Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Control Plane rejected this approval action");
    } finally {
      setBusy(undefined);
    }
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedGoalId === undefined || projectId === undefined || onRequest === undefined) return;
    const action = request.action.trim();
    const target = request.target.trim();
    if (action === "" || target === "") return;
    await run("request", () => onRequest({
      goalId: selectedGoalId,
      projectId,
      action,
      target,
      policyVersion: Number(request.policyVersion),
      budgetEffectCents: Number(request.budgetEffectCents),
    }));
  };

  const submitFullAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedGoalId === undefined || onSelectFullAccess === undefined || sessionId.trim() === "" || !fullAccessConfirmed) return;
    if (projectId === undefined) {
      setError("Full-access mode requires a connected project scope");
      return;
    }
    await run("full-access", () => onSelectFullAccess({ goalId: selectedGoalId, projectId, capabilityKind: capabilityKind.trim(), sessionId: sessionId.trim(), fullAccessMode }));
  };

  return (
    <div className="approvals-projection" aria-label="Approvals">
      <section className="approval-group" aria-labelledby="approval-critical-title">
        <div className="approval-group-head"><h2 id="approval-critical-title">Pending critical actions</h2><span className="badge badge-ochre">{items.length}</span></div>
        {items.length === 0 && <p className="dash-empty">No pending critical actions from the server.</p>}
        {items.map((item) => {
          const expiry = expiryByDecision[item.decisionId] ?? "";
          const discussion = discussions.find((entry) => entry.decisionId === item.decisionId);
          const text = discussionByDecision[item.decisionId] ?? "";
          return (
            <article key={item.decisionId} className="inbox-item pending approval-item">
              <div className="inbox-icon" style={{ background: "var(--ochre-bg)", color: "var(--ochre-text)" }}><Icon name="shield" /></div>
              <div className="inbox-body">
                <div className="inbox-title">{item.action} · {item.target}</div>
                <div className="approval-facts">
                  <span><strong>Effect:</strong> {item.action} on {item.target}</span>
                  <span><strong>Reason:</strong> {item.reason}</span>
                  <span><strong>Scope:</strong> project {item.projectId} · Goal {item.goalId}</span>
                  <span><strong>State:</strong> pending (listInbox)</span>
                  <span><strong>Command:</strong> {item.commandId}</span>
                  <span><strong>Expiry:</strong> not provided by listInbox contract; choose one before approval.</span>
                </div>
                <label className="approval-expiry-field" htmlFor={`approval-expiry-${item.decisionId}`}>
                  Approval expiry (required)
                  <input id={`approval-expiry-${item.decisionId}`} type="datetime-local" value={expiry} onChange={(event) => setExpiryByDecision((current) => ({ ...current, [item.decisionId]: event.target.value }))} />
                </label>
                <div className="inbox-actions">
                  <button className="inbox-link" type="button" disabled={busy !== undefined || expiry === ""} onClick={() => void run(item.decisionId, () => onApprove(item, expiry))}><Icon name="check" /> {busy === item.decisionId ? "approving…" : "approve and run"}</button>
                  <button className="inbox-link" type="button" disabled={busy !== undefined} onClick={() => void run(`deny-${item.decisionId}`, () => onDeny(item))}><Icon name="x" /> deny</button>
                  <button className="inbox-link" data-discuss-path="conversation" type="button" disabled={busy !== undefined} onClick={() => setDiscussionByDecision((current) => ({ ...current, [item.decisionId]: current[item.decisionId] ?? "" }))}><Icon name="message-circle" /> Discuss with Concertmaster</button>
                </div>
                {discussionByDecision[item.decisionId] !== undefined && <form className="inbox-discuss" onSubmit={(event) => { event.preventDefault(); if (text.trim() !== "") void run(`discuss-${item.decisionId}`, () => onDiscuss(item, text)); }}>
                  <label className="sr-only" htmlFor={`inbox-discuss-${item.decisionId}`}>Discuss with Concertmaster</label>
                  <textarea id={`inbox-discuss-${item.decisionId}`} value={text} onChange={(event) => setDiscussionByDecision((current) => ({ ...current, [item.decisionId]: event.target.value }))} placeholder="Ask about this decision" />
                  <button className="btn btn-sm" type="submit" disabled={busy !== undefined || text.trim() === ""}>send</button>
                </form>}
                {discussion !== undefined && <div className="approval-discussion" role="status"><strong>Concertmaster discussion</strong><span>conversation {discussion.conversationId} · project {discussion.projectId} · Goal {discussion.goalId}</span><p>{discussion.response}</p></div>}
              </div>
            </article>
          );
        })}
      </section>

      <section className="approval-group" aria-labelledby="approval-worker-title">
        <div className="approval-group-head"><h2 id="approval-worker-title">Worker and certification decisions</h2><span className="badge badge-slate">{workerDecisions.length}</span></div>
        {workerDecisions.length === 0 ? <p className="dash-empty">No worker or certification decisions were returned for the selected Goal.</p> : workerDecisions.map((decision) => <article key={decision.id} className="inbox-item info"><div className="inbox-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="check" /></div><div className="inbox-body"><div className="inbox-title">{decision.title}</div><div className="inbox-sub">{decision.detail}</div>{decision.onReview !== undefined && <div className="inbox-actions"><button type="button" className="inbox-link" onClick={decision.onReview}>review in Git</button></div>}</div></article>)}
      </section>

      <section className="approval-group" aria-labelledby="approval-discussions-title">
        <div className="approval-group-head"><h2 id="approval-discussions-title">Concertmaster discussions</h2><span className="badge badge-slate">{discussions.length}</span></div>
        {discussions.length === 0 ? <p className="dash-empty">No Concertmaster discussions are open.</p> : discussions.map((discussion) => <article key={`${discussion.decisionId}-${discussion.conversationId}`} className="inbox-item info"><div className="inbox-icon" style={{ background: "var(--p-slate-bg)", color: "var(--p-slate-text)" }}><Icon name="message-circle" /></div><div className="inbox-body"><div className="inbox-title">pending approval discussion · {discussion.decisionId}</div><div className="inbox-sub">conversation {discussion.conversationId} · project {discussion.projectId} · Goal {discussion.goalId}</div><p className="inbox-sub">{discussion.response}</p></div></article>)}
      </section>

      {selectedGoalId !== undefined && onRequest !== undefined && <section className="approval-group approval-form" aria-labelledby="approval-request-title">
        <h2 id="approval-request-title">Request critical action</h2>
        <p className="form-hint">The request is classified by the server. A request that needs approval remains pending in this Inbox.</p>
        <form onSubmit={(event) => void submitRequest(event)}>
          <input aria-label="Action" className="input" value={request.action} onChange={(event) => setRequest((current) => ({ ...current, action: event.target.value }))} placeholder="action" />
          <input aria-label="Target" className="input" value={request.target} onChange={(event) => setRequest((current) => ({ ...current, target: event.target.value }))} placeholder="target" />
          <input aria-label="Policy version" className="input" type="number" min="0" value={request.policyVersion} onChange={(event) => setRequest((current) => ({ ...current, policyVersion: event.target.value }))} />
          <input aria-label="Budget effect cents" className="input" type="number" min="0" value={request.budgetEffectCents} onChange={(event) => setRequest((current) => ({ ...current, budgetEffectCents: event.target.value }))} />
          <button className="btn btn-primary" type="submit" disabled={busy !== undefined || request.action.trim() === "" || request.target.trim() === ""}>{busy === "request" ? "requesting…" : "request critical action"}</button>
        </form>
      </section>}

      {selectedGoalId !== undefined && onSelectFullAccess !== undefined && <section className="approval-group approval-form" aria-labelledby="approval-full-access-title">
        <h2 id="approval-full-access-title">Full-access mode</h2>
        <p className="form-hint">Selection is not active until the server confirms this exact Goal-bound session. This does not approve an individual action; explicit confirmation is required.</p>
        <form onSubmit={(event) => void submitFullAccess(event)}>
          <label className="form-label" htmlFor="approval-capability-kind">Capability kind</label>
          <input id="approval-capability-kind" className="input" value={capabilityKind} onChange={(event) => setCapabilityKind(event.target.value)} />
          <label className="form-label" htmlFor="approval-session-id">Session ID</label>
          <input id="approval-session-id" className="input" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="server-issued session UUID" />
          <label className="form-label" htmlFor="approval-full-access-mode">Mode</label>
          <select id="approval-full-access-mode" className="input" value={fullAccessMode} onChange={(event) => setFullAccessMode(event.target.value as FullAccessMode)}><option value="retain_intermediate_approvals">retain intermediate approvals</option><option value="skip_intermediate_approvals">skip intermediate approvals</option></select>
          <label className="approval-confirm-check"><input type="checkbox" checked={fullAccessConfirmed} onChange={(event) => setFullAccessConfirmed(event.target.checked)} /> I explicitly confirm this Goal-scoped full-access selection.</label>
          <button className="btn" type="submit" disabled={busy !== undefined || sessionId.trim() === "" || !fullAccessConfirmed}>{busy === "full-access" ? "confirming…" : "confirm full-access mode"}</button>
        </form>
        {fullAccessSession !== undefined && <p className="alert alert-success" role="status">Server confirmed {fullAccessSession.fullAccessMode} for {fullAccessSession.capabilityKind}; session {fullAccessSession.sessionId}.</p>}
      </section>}
      {error !== undefined && <p className="alert alert-warning" role="alert">{error}</p>}
    </div>
  );
}
