
export function Flashmob({ onOpenSession }: { onOpenSession: () => void }) {
  return (
    <div className="workspace-view">
      <header className="workspace-view-head">
        <div className="dash-kicker">Act 2 · deferred</div>
        <h1 className="dash-title">flashmob</h1>
        <p className="dash-sub">Flashmob/Vanguard is a bounded fast path planned for Act 2, not a live Carnegie capability.</p>
      </header>
      <div className="page-body workspace-view-body" data-capability-status="out-of-scope">
        <section className="capability-dependency" aria-labelledby="flashmob-deferred-title">
          <div className="capability-status-row">
            <span className="badge badge-slate">out-of-scope</span>
            <span className="badge badge-rust">backend-blocked</span>
          </div>
          <h2 id="flashmob-deferred-title">Flashmob is deferred</h2>
          <p>
            Act 2 starts only after Act 1 is certified and the project owner opens the roadmap gate. No sample session is a live run.
          </p>
          <h3>Missing durable contract</h3>
          <ul>
            <li>project-scoped Flashmob session/run records with provenance and evidence references</li>
            <li>bounded read, send, observe, and cancellation methods with idempotency, lease, and authority checks</li>
            <li>an explicit promotion command that returns a real Goal or Task Contract ID and carries evidence forward</li>
          </ul>
          <h3>Re-entry condition</h3>
          <p>
            Re-enter when the Act 2 gate is opened and those Control Plane, API client, Electron bridge, and durable evidence contracts exist.
          </p>
          <button type="button" className="btn btn-sm" onClick={onOpenSession}>view deferred session contract</button>
        </section>
      </div>
    </div>
  );
}
