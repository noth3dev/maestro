import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGitIntegrationState } from "../useGitIntegrationState.js";

export function Git({ onBack }: { onBack: () => void }) {
  const { config } = useConnection();
  const { state, loading, error } = useGitIntegrationState();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="gitbar">
        <div className="gitbar-back" onClick={onBack}><Icon name="arrow-left" /> back</div>
        <div className="gitbar-path"><Icon name="folder" /> {state?.branch?.repositoryPath ?? "no integration branch yet"}</div>
        <div className="gitbar-branch"><Icon name="git-branch" /> {state?.branch?.branchName ?? "—"}</div>
      </div>
      <div className="git-body">
        {config === undefined && <EmptyState />}
        {config !== undefined && loading && <p style={{ padding: 16 }}>loading…</p>}
        {config !== undefined && error !== undefined && <div className="alert alert-warning" style={{ margin: 16 }}>{error}</div>}
        {config !== undefined && !loading && error === undefined && state !== undefined && state.branch === null && (
          <EmptyState title="No Goal integration branch yet" hint="This Goal has not created an integration branch through the control plane yet." />
        )}
        {state?.branch !== undefined && state.branch !== null && (
          <div className="git-files" style={{ padding: 12 }}>
            <div className="git-files-label">integration branch</div>
            <div className="git-file-item"><Icon name="git-branch" style={{ width: 14, height: 14 }} /><span className="name">{state.branch.branchName}</span></div>
            <div className="git-files-label" style={{ marginTop: 10 }}>base revision</div>
            <div className="git-file-item"><Icon name="hash" style={{ width: 14, height: 14 }} /><span className="name">{state.branch.baseRevision}</span></div>
            <div className="git-files-label" style={{ marginTop: 10 }}>latest frozen revision</div>
            {state.latestRevision === null ? (
              <p>No revision has been frozen for this Goal yet.</p>
            ) : (
              <>
                <div className="git-file-item"><Icon name="hash" style={{ width: 14, height: 14 }} /><span className="name">rev {state.latestRevision.revisionNumber} · {state.latestRevision.commitSha.slice(0, 12)}…</span></div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
