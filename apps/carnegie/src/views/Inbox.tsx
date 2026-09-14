import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";
import type { ViewName } from "../views.js";

export function Inbox({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { detail, loading, error } = useGoalDetail();

  if (config === undefined) return <EmptyState />;

  return (
    <div className="inbox-main">
      <div className="dash-head" style={{ padding: "20px 20px 0" }}><div className="dash-title">inbox</div></div>
      <div className="dash-sub" style={{ padding: "0 20px 14px" }}>certifications for the selected Goal, most recent first</div>
      <div className="inbox-list">
        <div style={{ padding: "0 20px 14px" }}>
          <EmptyState
            title="Pending critical-action approvals aren't listable here yet"
            hint="Maestro's authority model doesn't durably record a 'pending approval request' -- a require_approval decision is evaluated fresh each call, not stored, so there is nothing to list yet without a new durable record type. Approve-and-run already works today once you have the exact action/target to approve."
          />
        </div>

        {loading && <p style={{ padding: "0 20px" }}>loading…</p>}
        {error !== undefined && <div className="alert alert-warning" style={{ margin: "0 20px" }}>{error}</div>}
        {!loading && error === undefined && detail !== undefined && detail.certifications.length === 0 && (
          <p style={{ padding: "0 20px" }}>No certifications recorded for this Goal yet.</p>
        )}
        {detail?.certifications.map((certification) => (
          <div key={certification.certificationId} className="inbox-item info">
            <div className="inbox-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="check" /></div>
            <div className="inbox-body">
              <div className="inbox-title">{certification.kind} · {certification.verdict} · {certification.producingDepartment}</div>
              <div className="inbox-sub">commit {certification.integratedCommitSha.slice(0, 12)}… · certified by {certification.certifiedByDepartment}</div>
              <div className="inbox-actions">
                <button className="inbox-link" onClick={() => onNavigate("git")}><Icon name="external-link" /> view in Git</button>
              </div>
            </div>
          </div>
        ))}
        {detail === undefined && !loading && error === undefined && (
          <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to see its real certifications here." />
        )}
      </div>
    </div>
  );
}
