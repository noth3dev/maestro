import React, { useEffect, useState } from "react";
import type { MissionBundle, Worker, WorkerObservation } from "@maestro/contracts";
import { Icon } from "../icons.js";
import { cancelWorkerAfterConfirmation, loadWorkerObservation, missionBundleMatchesWorker, sendWorkerMessage, type WorkerApi } from "../lib/worker-data.js";

export interface WorkersProps {
  api: WorkerApi;
  projectId: string;
  goalId: string;
  workers: readonly Worker[];
  missionBundle: MissionBundle | undefined;
  selectedWorkerId?: string | undefined;
  channelName?: string | undefined;
  onOpenChannel?: () => void;
  onSelectWorker?: (workerId: string) => void;
  onRefresh?: () => void | Promise<void>;
}

function workerLabel(worker: Worker): string {
  return `${worker.departmentId} · ${worker.itemId}`;
}

export function Workers({ api, projectId, goalId, workers, missionBundle, selectedWorkerId, channelName = "#department", onOpenChannel, onSelectWorker, onRefresh }: WorkersProps) {
  const selectedWorker = workers.find((worker) => worker.workerId === selectedWorkerId) ?? workers[0];
  const bundleMatchesSelection = selectedWorker !== undefined && missionBundle !== undefined && missionBundleMatchesWorker(missionBundle, selectedWorker);
  const [observation, setObservation] = useState<WorkerObservation | undefined>(undefined);
  const [observedWorkerId, setObservedWorkerId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const currentObservation = selectedWorker !== undefined && observedWorkerId === selectedWorker.workerId ? observation : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setObservation(undefined);
    setObservedWorkerId(undefined);
    setConfirmCancel(false);
    setError(undefined);
    setMessage("");
  }, [selectedWorkerId]);

  const observe = async (): Promise<void> => {
    if (selectedWorker === undefined || !bundleMatchesSelection || missionBundle === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setObservation(await loadWorkerObservation(api, selectedWorker.workerId, { goalId, projectId, bundle: missionBundle }));
      setObservedWorkerId(selectedWorker.workerId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not observe Worker");
    } finally {
      setBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    if (selectedWorker === undefined || !bundleMatchesSelection || missionBundle === undefined || message.trim() === "" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await sendWorkerMessage(api, selectedWorker.workerId, { goalId, projectId, bundle: missionBundle }, message);
      setMessage("");
      await onRefresh?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not message Worker");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (selectedWorker === undefined || !bundleMatchesSelection || missionBundle === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await cancelWorkerAfterConfirmation(api, selectedWorker.workerId, { goalId, projectId, bundle: missionBundle }, true);
      setConfirmCancel(false);
      await onRefresh?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel Worker");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="worker-detail-panel" aria-label="Worker detail">
      <header className="worker-detail-head">
        <div>
          <p className="dash-kicker">Goal {goalId}</p>
          <h2>Worker detail</h2>
        </div>
        <button type="button" className="btn btn-sm" onClick={onOpenChannel} disabled={onOpenChannel === undefined}>
          <Icon name="message-circle" /> {channelName}
        </button>
      </header>

      {workers.length === 0 && <p className="office-panel-empty">No Worker has been admitted for this Goal.</p>}
      {workers.length > 0 && (
        <>
          <section className="worker-roster" aria-labelledby="worker-roster-heading">
            <h3 id="worker-roster-heading">Worker roster</h3>
            {workers.map((worker) => <button key={worker.workerId} type="button" className={`worker-roster-item${worker.workerId === selectedWorker?.workerId ? " selected" : ""}`} aria-pressed={worker.workerId === selectedWorker?.workerId} onClick={() => onSelectWorker?.(worker.workerId)} disabled={onSelectWorker === undefined}><span>{workerLabel(worker)}</span><span>{worker.status}</span></button>)}
          </section>

          {selectedWorker !== undefined && (
            <section className="worker-scope" aria-labelledby="worker-scope-heading">
              <h3 id="worker-scope-heading">Mission Bundle scope</h3>
              <p>worker {selectedWorker.workerId}</p>
              <p>{workerLabel(selectedWorker)}</p>
              <p>plan {selectedWorker.planVersion} · attempt {selectedWorker.attempt}</p>
              <p>bundle hash {selectedWorker.bundleContentHash}</p>
              <p>execution {selectedWorker.executionRef} · invocation {selectedWorker.invocationRef}</p>
              <div className="worker-actions">
                <button type="button" className="btn btn-sm" onClick={() => void observe()} disabled={busy || !bundleMatchesSelection}>Observe worker</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmCancel(true)} disabled={busy || !bundleMatchesSelection || ["succeeded", "failed", "cancelled", "unknown"].includes(selectedWorker.status)}>Cancel worker</button>
              </div>
              {confirmCancel && <div className="alert alert-warning" role="alert"><span>Cancel this Worker and record the result?</span><button type="button" className="btn btn-sm btn-danger" onClick={() => void cancel()} disabled={busy || !bundleMatchesSelection}>Confirm cancel</button><button type="button" className="btn btn-sm" onClick={() => setConfirmCancel(false)} disabled={busy}>Keep running</button></div>}
            </section>
          )}
        </>
      )}

      <section className="worker-conversation" aria-labelledby="worker-conversation-heading">
        <h3 id="worker-conversation-heading">Worker conversation and activity</h3>
        {currentObservation?.answerText !== null && currentObservation?.answerText !== undefined ? <p>{currentObservation.answerText}</p> : <p className="office-panel-empty">Observe the Worker to load its latest durable answer and tool activity.</p>}
        {currentObservation?.observability.toolEvents.state === "available" && currentObservation.observability.toolEvents.events.map((event) => <p key={event.ref} className="worker-activity"><span>{event.state}</span> {event.toolName ?? "tool activity"}</p>)}
        <label className="form-field" htmlFor="worker-message"><span className="form-label">Message this Worker</span><textarea id="worker-message" className="input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask for a bounded status update" disabled={selectedWorker === undefined || !bundleMatchesSelection || busy} /></label>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void send()} disabled={selectedWorker === undefined || !bundleMatchesSelection || message.trim() === "" || busy}>Send message</button>
        <p className="form-hint">Worker messages and cross-worker coordination stay in the Goal-scoped channel and remain auditable.</p>
        <button type="button" className="btn btn-sm" onClick={() => void onRefresh?.()} disabled={busy || onRefresh === undefined}>Reload durable Worker state</button>
      </section>
      {!bundleMatchesSelection && <p className="alert alert-warning" role="status">{missionBundle === undefined ? "No Mission Bundle is available. Worker actions are disabled until a durable bundle is loaded." : "The Mission Bundle does not match the selected Worker. Reload durable state before acting."}</p>}
      {error !== undefined && <p className="alert alert-warning" role="alert">{error}</p>}
    </aside>
  );
}
