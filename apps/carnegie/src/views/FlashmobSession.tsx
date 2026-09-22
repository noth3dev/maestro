
import { Icon } from "../icons.js";

export function FlashmobSession({ onBack }: { onBack: () => void }) {
  return (
    <div className="fm-thread">
      <div className="fm-thread-head">
        <button type="button" className="fm-thread-back" onClick={onBack}><Icon name="arrow-left" /> flashmob</button>
        <div className="fm-thread-title">deferred Flashmob session contract</div>
        <span className="badge badge-slate" style={{ marginLeft: 4 }}>out-of-scope</span>
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginLeft: "auto" }}
          disabled
          title="No promotion command exists in the current backend contract"
        >
          <Icon name="arrow-up-right" style={{ width: 12, height: 12 }} /> promote to goal
        </button>
      </div>
      <section className="page-body workspace-view-body" aria-labelledby="flashmob-session-deferred-title" data-capability-status="backend-blocked">
        <div className="capability-status-row">
          <span className="badge badge-rust">backend-blocked</span>
        </div>
        <h2 id="flashmob-session-deferred-title">no durable Flashmob session exists</h2>
        <p>
          Carnegie cannot show a Worker, Goal, progress, or completed result here. The current Control Plane has no Flashmob session,
          provenance, or promotion method, so this screen is intentionally empty.
        </p>
        <h3>Re-entry condition</h3>
        <p>
          Enable the Act 2 roadmap gate after Act 1 certification, then add the typed session/run and promotion contracts before this
          composer or promotion control can be enabled.
        </p>
      </section>
      <form className="channel-input" onSubmit={(event) => event.preventDefault()}>
        <div className="chan-composer">
          <label className="sr-only" htmlFor="flashmob-composer">Flashmob message</label>
          <textarea
            id="flashmob-composer"
            className="chan-composer-input"
            placeholder="Flashmob (Vanguard) is deferred until its durable backend contract exists."
            rows={1}
            disabled
            aria-describedby="flashmob-composer-hint"
          />
          <button type="submit" className="btn btn-sm" disabled>send</button>
        </div>
        <span id="flashmob-composer-hint" className="form-hint">Composer disabled: no real Flashmob session is available.</span>
      </form>
    </div>
  );
}
