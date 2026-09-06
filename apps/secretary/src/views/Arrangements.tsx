import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalImprovementDigests } from "../useGoalImprovementDigests.js";

export function Arrangements() {
  const { config } = useConnection();
  const { digests, loading, error } = useGoalImprovementDigests();

  if (config === undefined) return <EmptyState />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="dash-head" style={{ padding: "14px 20px 0" }}><div className="dash-title">arrangements</div></div>
      <div className="dash-sub" style={{ padding: "0 20px" }}>improvement digests recorded for the selected Goal -- curated summaries only, no automatic changes</div>

      <div className="page-body">
        {loading && <p>loading…</p>}
        {error !== undefined && <div className="alert alert-warning">{error}</div>}
        {!loading && error === undefined && digests !== undefined && digests.length === 0 && (
          <p>No improvement digests recorded for this Goal yet.</p>
        )}
        {digests?.map((digest) => (
          <div key={digest.digestId} className="arr-item">
            <div className="arr-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="lightbulb" /></div>
            <div className="arr-body">
              <div className="arr-title">{digest.selectedDecision}</div>
              <div className="arr-meta">{digest.trigger} · confidence {(digest.confidence * 100).toFixed(0)}%</div>
              <div className="arr-meta">situation: {digest.situation}</div>
              <div className="arr-meta">observed: {digest.observedResult}</div>
              {digest.metrics.length > 0 && (
                <div className="arr-deltas">
                  {digest.metrics.map((metric) => <span key={metric.name}>{metric.name} {metric.value}{metric.unit}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <p style={{ padding: "0 20px 14px", fontSize: 12, opacity: 0.7 }}>
        Candidate mutation, shadow-replay evaluation, live Encore Council deliberation, and rollout are
        deliberately not implemented yet (Phase 6 Slice 1 scope): only append-only curated digests exist so far.
      </p>
    </div>
  );
}
