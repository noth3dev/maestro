import { Icon } from "../icons.js";
import type { ViewName } from "../views.js";

const departments = [
  { name: "product", icon: "package", awake: true, state: "2 active" },
  { name: "tech", icon: "code", awake: true, state: "3 active" },
  { name: "intelligence", icon: "flask-conical", awake: false, state: "asleep" },
  { name: "assurance", icon: "clipboard-check", awake: false, state: "asleep" },
  { name: "operations", icon: "settings", awake: false, state: "asleep" },
];

export function Dashboard({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  return (
    <div className="dash-main">
      <div className="dash-head">
        <div className="dash-title">launch page</div>
        <span className="dash-status">active</span>
      </div>
      <div className="dash-sub">movement 2 of 4 · started 3 days ago</div>

      <div className="dash-stats">
        <div className="stat-card stat-terracotta"><p className="stat-label">missions in flight</p><p className="stat-value">4</p></div>
        <div className="stat-card stat-ochre"><p className="stat-label">pending approvals</p><p className="stat-value">3</p></div>
        <div className="stat-card stat-olive"><p className="stat-label">certified</p><p className="stat-value">7</p></div>
        <div className="stat-card stat-rust"><p className="stat-label">departments awake</p><p className="stat-value">2 / 5</p></div>
      </div>

      <div className="dash-section-title">groups</div>
      <div className="dept-grid">
        {departments.map((department) => (
          <div key={department.name} className={`dept-card ${department.awake ? "awake" : "asleep"}`}>
            <div className="dept-card-head"><Icon name={department.icon} /><span className="dept-card-name">{department.name}</span></div>
            <div className={`dept-card-state${department.awake ? " on" : ""}`}>{department.state}</div>
          </div>
        ))}
      </div>

      <div className="dash-section-title">pipeline</div>
      <div className="kanban">
        <div>
          <div className="kanban-col-head"><Icon name="file-text" style={{ width: 13, height: 13 }} /> task contract <span className="n">1</span></div>
          <div className="kanban-col">
            <div className="kcard" onClick={() => onNavigate("channel")}>
              <div className="kcard-title">launch page — overall scope</div>
              <div className="kcard-meta">
                <div className="kcard-dept"><Icon name="compass" /> overture</div>
                <span className="badge badge-olive kcard-badge">sealed</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="kanban-col-head"><Icon name="clipboard-list" style={{ width: 13, height: 13 }} /> department plan <span className="n">2</span></div>
          <div className="kanban-col">
            <div className="kcard" onClick={() => onNavigate("channel")}>
              <div className="kcard-title">hero section rebuild</div>
              <div className="kcard-meta">
                <div className="kcard-dept"><Icon name="code" /> engineering</div>
                <span className="badge badge-ochre kcard-badge">planning</span>
              </div>
            </div>
            <div className="kcard">
              <div className="kcard-title">pricing table copy</div>
              <div className="kcard-meta">
                <div className="kcard-dept"><Icon name="package" /> product</div>
                <span className="badge badge-ochre kcard-badge">planning</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="kanban-col-head"><Icon name="loader" style={{ width: 13, height: 13 }} /> mission bundle <span className="n">1</span></div>
          <div className="kanban-col">
            <div className="kcard" onClick={() => onNavigate("channel")}>
              <div className="kcard-title">hero section — write scope</div>
              <div className="kcard-meta">
                <div className="kcard-dept"><Icon name="code" /> engineering</div>
                <span className="badge badge-rust kcard-badge">in progress</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="kanban-col-head"><Icon name="shield-check" style={{ width: 13, height: 13 }} /> certified <span className="n">1</span></div>
          <div className="kanban-col">
            <div className="kcard" onClick={() => onNavigate("git")}>
              <div className="kcard-title">hero section</div>
              <div className="kcard-meta">
                <div className="kcard-dept"><Icon name="code" /> engineering</div>
              </div>
              <div className="kcard-cert"><Icon name="check" /> sha256 4f2a…</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
