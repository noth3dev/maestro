import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";
import type { ViewName } from "../views.js";

export function EvidenceLog({ onNavigate: _onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { detail, loading, error } = useGoalDetail();

  if (config === undefined) return <EmptyState />;

  return (
    <div className="evlog-main">
      <header className="workspace-view-head">
        <div className="dash-kicker">proof &amp; history</div>
        <h1 className="dash-title">evidence log</h1>
        <p className="dash-sub">Certified work for the selected Goal, real durable certifications only.</p>
      </header>
      <div className="workspace-view-body">
      {loading && <p>loading…</p>}
      {error !== undefined && <div className="alert alert-warning">{error}</div>}
      {!loading && error === undefined && detail !== undefined && detail.certifications.length === 0 && (
        <p>No certifications recorded for this Goal yet.</p>
      )}
      {detail?.certifications.map((certification) => (
        <div key={certification.certificationId} className="evlog-item">
          <div className="evlog-icon"><Icon name={certification.verdict === "passed" ? "check" : certification.verdict === "blocked" ? "shield-alert" : "x"} /></div>
          <div>
            <div className="evlog-title">{certification.kind} · {certification.verdict} · {certification.producingDepartment}</div>
            <div className="evlog-sub">commit {certification.integratedCommitSha.slice(0, 12)}… · certified by {certification.certifiedByDepartment}</div>
          </div>
        </div>
      ))}
      {detail === undefined && !loading && error === undefined && (
        <EmptyState
          title="No Goal selected"
          hint="Select a Goal from the Dashboard to see its real certification history here."
        />
      )}
      </div>
    </div>
  );
}
