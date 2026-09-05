import { Icon } from "../icons.js";
import type { ViewName } from "../views.js";

const entries = [
  { title: "hero section — launch page", sub: "sha256 4f2a7c1e… · engineering", time: "10:22" },
  { title: "pricing table copy — launch page", sub: "sha256 9b0e21aa… · product", time: "09:47" },
  { title: "auth migration step 3 — billing refactor", sub: "sha256 3ac880fd… · engineering", time: "yesterday" },
];

export function EvidenceLog({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  return (
    <div className="evlog-main">
      <div className="dash-head" style={{ padding: "20px 20px 0" }}><div className="dash-title">evidence log</div></div>
      <div className="dash-sub" style={{ padding: "0 20px 14px" }}>certified work across every goal, most recent first</div>
      {entries.map((entry) => (
        <div key={entry.title} className="evlog-item" onClick={() => onNavigate("git")}>
          <div className="evlog-icon"><Icon name="check" /></div>
          <div>
            <div className="evlog-title">{entry.title}</div>
            <div className="evlog-sub">{entry.sub}</div>
          </div>
          <div className="evlog-time">{entry.time}</div>
        </div>
      ))}
    </div>
  );
}
