import React, { useEffect, useState } from "react";
import type { Certification, EvidenceBundleRead, EvidenceCaptureInput, EvidenceRecord } from "@maestro/contracts";
import type { GoalEvent } from "@maestro/api-client";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { filterEvents, eventLinks, loadEventPage, type EventFilters } from "../lib/event-data.js";
import { captureEvidence, getEvidenceBundle, getEvidenceDump, listCertifications } from "../lib/integration-data.js";
import { newCommandId } from "../lib/command-id.js";
import type { ViewName } from "../views.js";

interface EvidenceDump {
  bundle: EvidenceBundleRead;
  certifications: { certifications: readonly Certification[] };
  report: { reportId: string; success: boolean; evidenceBundleId: string };
}

function shortSha(value: string): string {
  return `${value.slice(0, 12)}…`;
}

export function EvidenceLog({ onNavigate, eventCursor = "0" }: { onNavigate: (view: ViewName) => void; eventCursor?: string }) {
  const { config } = useConnection();
  const { goals, selectedGoalId } = useGoals();
  const [bundle, setBundle] = useState<EvidenceBundleRead | undefined>(undefined);
  const [certifications, setCertifications] = useState<readonly Certification[]>([]);
  const [dump, setDump] = useState<EvidenceDump | undefined>(undefined);
  const [captured, setCaptured] = useState<EvidenceRecord | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [captureError, setCaptureError] = useState<string | undefined>(undefined);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [events, setEvents] = useState<readonly GoalEvent[]>([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | undefined>(undefined);
  const [eventFilters, setEventFilters] = useState<EventFilters>({});
  const [correlationId, setCorrelationId] = useState("");
  const [kind, setKind] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [contentBase64, setContentBase64] = useState("");

  useEffect(() => {
    setBundle(undefined);
    setCertifications([]);
    setDump(undefined);
    setCaptured(undefined);
    setError(undefined);
    if (config === undefined || selectedGoalId === undefined) return;
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      getEvidenceBundle(window.maestro.api, selectedGoalId, { projectId: config.projectId }),
      listCertifications(window.maestro.api, selectedGoalId, { projectId: config.projectId }),
      getEvidenceDump(window.maestro.api, selectedGoalId, { projectId: config.projectId }),
    ])
      .then(([bundleResult, certificationResult, dumpResult]) => {
        if (!active) return;
        if (bundleResult.status === "fulfilled") setBundle(bundleResult.value);
        if (certificationResult.status === "fulfilled") setCertifications(certificationResult.value.certifications);
        if (dumpResult.status === "fulfilled") setDump(dumpResult.value as EvidenceDump);
        if (bundleResult.status === "rejected" && certificationResult.status === "rejected" && dumpResult.status === "rejected") {
          const cause = bundleResult.reason;
          setError(cause instanceof Error ? cause.message : "Could not load durable evidence");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [config?.projectId, selectedGoalId]);

  useEffect(() => {
    setEvents([]);
    setEventError(undefined);
    setEventFilters((current) => ({ ...current, goalId: selectedGoalId ?? "" }));
    if (config === undefined) return;
    let active = true;
    setEventLoading(true);
    void loadEventPage(window.maestro.api, { projectId: config.projectId, after: "0" })
      .then((page) => {
        if (active) setEvents(page.events);
      })
      .catch((cause: unknown) => {
        if (active) setEventError(cause instanceof Error ? cause.message : "Could not load durable events");
      })
      .finally(() => {
        if (active) setEventLoading(false);
      });
    return () => {
      active = false;
    };
  }, [config?.projectId, selectedGoalId, eventCursor]);

  if (config === undefined) return <EmptyState />;

  const capture = async (): Promise<void> => {
    if (
      selectedGoalId === undefined ||
      correlationId.trim() === "" ||
      kind.trim() === "" ||
      mediaType.trim() === "" ||
      contentBase64.trim() === "" ||
      captureBusy
    )
      return;
    setCaptureBusy(true);
    setCaptureError(undefined);
    const input: EvidenceCaptureInput = {
      projectId: config.projectId,
      correlationId: correlationId.trim(),
      commandId: newCommandId(),
      kind: kind.trim(),
      mediaType: mediaType.trim(),
      contentBase64: contentBase64.trim(),
    };
    try {
      const record = await captureEvidence(window.maestro.api, selectedGoalId, input);
      setCaptured(record);
      setContentBase64("");
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "Could not capture evidence");
    } finally {
      setCaptureBusy(false);
    }
  };

  const filteredEvents = filterEvents(events, eventFilters);
  const eventTypes = [...new Set(events.map((event) => event.eventType))].sort();

  return (
    <div className="evlog-main">
      <header className="workspace-view-head">
        <div className="dash-kicker">proof &amp; history</div>
        <h1 className="dash-title">evidence log</h1>
        <p className="dash-sub">
          Immutable evidence and certifications for the selected Goal. All records below come from the control plane.
        </p>
      </header>
      <div className="workspace-view-body">
        {loading && <p role="status">loading durable evidence…</p>}
        {error !== undefined && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        {selectedGoalId === undefined && !loading && (
          <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to see its durable evidence." />
        )}

        {bundle !== undefined && (
          <section className="office-panel" aria-labelledby="evidence-bundle-heading">
            <h2 id="evidence-bundle-heading">Evidence bundle</h2>
            <p>bundle ID: {bundle.bundleId}</p>
            <p>Goal ID: {bundle.goalId}</p>
            <p>content hash: {bundle.hash}</p>
            <p className="form-hint">Bundle content is read-only. Carnegie does not edit or delete evidence.</p>
          </section>
        )}

        <section className="office-panel" aria-labelledby="evidence-certifications-heading">
          <h2 id="evidence-certifications-heading">Certifications</h2>
          {certifications.length === 0 ? (
            <p className="office-panel-empty">No certifications recorded for this Goal yet.</p>
          ) : (
            certifications.map((certification) => (
              <div key={certification.certificationId} className="evlog-item">
                <div className="evlog-icon">
                  <Icon name={certification.verdict === "passed" ? "check" : certification.verdict === "blocked" ? "shield-alert" : "x"} />
                </div>
                <div>
                  <div className="evlog-title">
                    {certification.kind} · {certification.verdict} · {certification.producingDepartment}
                  </div>
                  <div className="evlog-sub">
                    worker {certification.workerId} · commit {shortSha(certification.integratedCommitSha)} · certified by{" "}
                    {certification.certifiedByDepartment}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>

        {dump !== undefined && (
          <section className="office-panel" aria-labelledby="evidence-dump-heading">
            <h2 id="evidence-dump-heading">Read-only evidence dump</h2>
            <p>report ID: {dump.report.reportId}</p>
            <p>report outcome: {dump.report.success ? "passed" : "not passed"}</p>
            <p>report evidence bundle: {dump.report.evidenceBundleId}</p>
            <p>dump certifications: {dump.certifications.certifications.length}</p>
            <p className="form-hint">This dump is a durable server record. It cannot be edited or deleted here.</p>
          </section>
        )}

        <section className="office-panel" aria-labelledby="durable-events-heading">
          <h2 id="durable-events-heading">Durable project events</h2>
          <p className="form-hint">Events below are read from the Control Plane. Filters change the view of returned records only.</p>
          <div className="dash-field-group">
            <label className="dash-field">
              <span>Goal</span>
              <select
                className="input"
                aria-label="Filter events by Goal"
                value={eventFilters.goalId ?? ""}
                onChange={(event) => setEventFilters((current) => ({ ...current, goalId: event.target.value }))}
              >
                <option value="">All Goals</option>
                {(goals ?? []).map((goal) => <option key={goal.goalId} value={goal.goalId}>{goal.goalId}</option>)}
              </select>
            </label>
            <label className="dash-field">
              <span>Event type</span>
              <select
                className="input"
                aria-label="Filter events by type"
                value={eventFilters.eventType ?? ""}
                onChange={(event) => setEventFilters((current) => ({ ...current, eventType: event.target.value }))}
              >
                <option value="">All event types</option>
                {eventTypes.map((eventType) => <option key={eventType} value={eventType}>{eventType}</option>)}
              </select>
            </label>
            <label className="dash-field">
              <span>After cursor</span>
              <input className="input" inputMode="numeric" aria-label="Filter events after cursor" value={eventFilters.afterCursor ?? ""} onChange={(event) => setEventFilters((current) => ({ ...current, afterCursor: event.target.value }))} />
            </label>
            <label className="dash-field">
              <span>Before cursor</span>
              <input className="input" inputMode="numeric" aria-label="Filter events before cursor" value={eventFilters.beforeCursor ?? ""} onChange={(event) => setEventFilters((current) => ({ ...current, beforeCursor: event.target.value }))} />
            </label>
            <label className="dash-field">
              <span>From time</span>
              <input className="input" type="datetime-local" aria-label="Filter events from time" value={eventFilters.fromTime ?? ""} onChange={(event) => setEventFilters((current) => ({ ...current, fromTime: event.target.value }))} />
            </label>
            <label className="dash-field">
              <span>To time</span>
              <input className="input" type="datetime-local" aria-label="Filter events to time" value={eventFilters.toTime ?? ""} onChange={(event) => setEventFilters((current) => ({ ...current, toTime: event.target.value }))} />
            </label>
          </div>
          {eventLoading && <p role="status">loading durable events…</p>}
          {eventError !== undefined && <p className="alert alert-warning" role="alert">{eventError}</p>}
          {!eventLoading && eventError === undefined && filteredEvents.length === 0 && <p className="office-panel-empty">No durable events match these filters.</p>}
          <div className="event-log-list">
            {filteredEvents.map((event) => (
              <article key={event.eventId} className="office-subpanel event-log-item">
                <div><strong>{event.eventType}</strong> · cursor {event.cursor}</div>
                <div className="form-hint">Goal {event.goalId} · {new Date(event.occurredAt).toLocaleString()}</div>
                {eventLinks(event).length > 0 && (
                  <div className="event-log-links" aria-label={`Evidence links for ${event.eventType}`}>
                    {eventLinks(event).map((link) => <button key={link.view} type="button" className="btn btn-sm" onClick={() => onNavigate(link.view)}>{link.label}</button>)}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="office-panel" aria-labelledby="capture-evidence-heading">
          <h2 id="capture-evidence-heading">Capture evidence</h2>
          <p className="form-hint">
            Capture accepts only the documented evidence input. Use a real correlation ID and content encoded as base64.
          </p>
          <div className="dash-field-group">
            <label className="dash-field">
              <span>Correlation ID</span>
              <input
                className="input"
                value={correlationId}
                onChange={(event) => setCorrelationId(event.target.value)}
                placeholder="Durable operation correlation ID"
              />
            </label>
            <label className="dash-field">
              <span>Evidence kind</span>
              <input className="input" value={kind} onChange={(event) => setKind(event.target.value)} placeholder="e.g. test-result" />
            </label>
            <label className="dash-field">
              <span>Media type</span>
              <input
                className="input"
                value={mediaType}
                onChange={(event) => setMediaType(event.target.value)}
                placeholder="e.g. text/plain"
              />
            </label>
            <label className="dash-field">
              <span>Content (base64)</span>
              <textarea
                className="input"
                value={contentBase64}
                onChange={(event) => setContentBase64(event.target.value)}
                placeholder="Paste the evidence bytes as base64"
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={
              captureBusy ||
              selectedGoalId === undefined ||
              correlationId.trim() === "" ||
              kind.trim() === "" ||
              mediaType.trim() === "" ||
              contentBase64.trim() === ""
            }
            onClick={() => void capture()}
          >
            {captureBusy ? "Capturing…" : "Capture durable evidence"}
          </button>
          {captureError !== undefined && (
            <p className="alert alert-warning" role="alert">
              {captureError}
            </p>
          )}
          {captured !== undefined && (
            <div className="office-subpanel" role="status">
              <p>captured evidence ID: {captured.evidenceId}</p>
              <p>SHA-256: {captured.sha256}</p>
              <p>retention: {captured.retention}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
