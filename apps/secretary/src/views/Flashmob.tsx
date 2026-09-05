import { Icon } from "../icons.js";

export function Flashmob({ onOpenSession }: { onOpenSession: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="dash-head" style={{ padding: "20px 20px 0" }}><div className="dash-title">flashmob</div></div>
      <div className="dash-sub" style={{ padding: "0 20px 14px" }}>fast lane for light tasks · solo or tiny temp crew, no council, no certification</div>
      <div className="page-body" style={{ paddingTop: 0 }}>
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
