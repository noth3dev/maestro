import { Icon } from "../icons.js";

export function Flashmob({ onOpenSession }: { onOpenSession: () => void }) {
  return (
    <div className="workspace-view">
      <header className="workspace-view-head">
        <div className="dash-kicker">quick actions</div>
        <h1 className="dash-title">flashmob</h1>
        <p className="dash-sub">Fast lane for light tasks. This preview is not wired to a live backend yet.</p>
      </header>
      <div className="page-body workspace-view-body">
        <div className="fm-session" onClick={onOpenSession}>
          <div className="fm-session-icon"><Icon name="message-square" /></div>
          <div className="fm-session-body">
            <div className="fm-session-title">fix the pricing page copy</div>
            <div className="fm-session-sub">claude-haiku-4.5 · active · started 4 min ago</div>
          </div>
          <span className="badge badge-olive">active</span>
        </div>
        <div className="fm-session">
          <div className="fm-session-icon"><Icon name="message-square" /></div>
          <div className="fm-session-body">
            <div className="fm-session-title">summarize competitor pricing pages</div>
            <div className="fm-session-sub">claude-haiku-4.5 · done · 1 hour ago</div>
          </div>
          <span className="badge badge-slate">done</span>
        </div>
        <div className="fm-session">
          <div className="fm-session-icon"><Icon name="arrow-up-right" /></div>
          <div className="fm-session-body">
            <div className="fm-session-title">auth flow security audit</div>
            <div className="fm-session-sub">scope grew beyond grant · promoted to goal "billing refactor"</div>
          </div>
          <span className="badge badge-ochre">promoted</span>
        </div>
      </div>
    </div>
  );
}
