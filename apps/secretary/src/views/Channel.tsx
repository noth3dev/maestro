import { useState } from "react";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { useGoalWorkers } from "../useGoalWorkers.js";
import type { ViewName } from "../views.js";

export function Channel({ onNavigate: _onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { detail, loading, error } = useGoalDetail();
  const { workers, loading: workersLoading, error: workersError } = useGoalWorkers();
  const [rosterHidden, setRosterHidden] = useState(false);

  if (config === undefined) return <EmptyState />;

  return (
    <div className="channel-wrap" style={{ position: "relative" }}>
      <div className="channel-feed">
        <div className="channel-head">
          <Icon name="activity" /> Goal activity
          <span className="goalname">{detail?.goal.goalId ?? "no Goal selected"}</span>
          <div className="roster-toggle-btn" onClick={() => setRosterHidden((current) => !current)} title="toggle roster"><Icon name="panel-right" /></div>
        </div>
        <div className="channel-messages">
          {loading && <p>loading…</p>}
          {error !== undefined && <div className="alert alert-warning">{error}</div>}
          {!loading && error === undefined && detail !== undefined && detail.events.length === 0 && (
            <p>No durable events recorded for this Goal yet.</p>
          )}
          {detail?.events.map((event) => (
            <div key={event.eventId} className="msg">
              <div className="avatar avatar-sm av-teal"><Icon name="zap" style={{ width: 14, height: 14 }} /></div>
              <div className="msg-body">
                <div className="msg-head"><span className="msg-name">{event.eventType}</span><span className="msg-time">{new Date(event.occurredAt).toLocaleString()}</span></div>
                <div className="msg-text">cursor {event.cursor} · version {event.aggregateVersion}</div>
                <pre style={{ fontSize: 11, opacity: 0.75 }}>{JSON.stringify(event.payload, null, 2)}</pre>
              </div>
            </div>
          ))}
          {detail === undefined && !loading && error === undefined && (
            <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to see its real event activity here." />
          )}
        </div>
        <div className="channel-input">
          <div className="chan-composer">
            <textarea
              className="chan-composer-input"
              placeholder="Posting a message here isn't wired to anything real yet — Maestro has no chat/message-send capability in its domain model."
              rows={1}
              disabled
            />
          </div>
        </div>
      </div>

      <div className={`roster${rosterHidden ? " hide" : ""}`}>
        <div className="roster-head">roster{workers === undefined ? "" : ` · ${workers.length}`}</div>
        {workersLoading && <p style={{ padding: 12 }}>loading…</p>}
        {workersError !== undefined && <div className="alert alert-warning" style={{ margin: 12 }}>{workersError}</div>}
        {!workersLoading && workersError === undefined && workers !== undefined && workers.length === 0 && (
          <EmptyState title="No workers yet" hint="No worker has been spawned for this Goal yet." />
        )}
        {workers?.map((worker) => (
          <div key={worker.workerId} className="roster-item">
            <div className="avatar avatar-sm av-terracotta">{worker.departmentId.slice(0, 2).toUpperCase()}</div>
            <span>{worker.itemId}</span>
            <span className="roster-role-badge">{worker.departmentId}</span>
            <div className={`roster-dot ${worker.status === "running" || worker.status === "spawned" ? "dot-active" : "dot-idle"}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
