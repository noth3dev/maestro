import { useState } from "react";
import type { TaskContract } from "@maestro/contracts";
import { Icon } from "../icons.js";
import { useConnection } from "../connection.js";
import type { ViewName } from "../views.js";
import type { HomeMode } from "../homeMode.js";
import {
  buildTaskContractDraft,
  confirmTaskContractDraft,
  createTaskContractDraft,
  launchTaskContractDraft,
  updateTaskContractDraft,
} from "../lib/task-contract-authoring.js";

const homeTitles = [
  "what should the floor work on",
  "give the floor a brief",
  "what needs the orchestra today",
  "what should the concertmaster take on",
];

const suggestions = ["fix the pricing page copy", "audit the auth flow for gaps", "clean up legacy docs"];

type DraftForm = {
  desiredOutcome: string;
  successCriteria: string;
  repository: string;
  immutableBaseRevision: string;
  dataBoundary: string;
};

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}

function formFromContract(contract: TaskContract): DraftForm {
  return {
    desiredOutcome: contract.desiredOutcome,
    successCriteria: contract.successCriteria.join("\n"),
    repository: contract.project.repository,
    immutableBaseRevision: contract.project.immutableBaseRevision,
    dataBoundary: contract.project.dataBoundary,
  };
}

export function Home({ onNavigate, mode, onModeChange }: { onNavigate: (view: ViewName) => void; mode: HomeMode; onModeChange: (mode: HomeMode) => void }) {
  const { config } = useConnection();
  const [title] = useState(() => homeTitles[Math.floor(Math.random() * homeTitles.length)]);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<TaskContract | undefined>(undefined);
  const [draftForm, setDraftForm] = useState<DraftForm | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const isFlashmob = mode === "flashmob";
  const dirty = draft !== undefined && draftForm !== undefined && JSON.stringify(draftForm) !== JSON.stringify(formFromContract(draft));

  const submitBrief = async (event: React.FormEvent) => {
    event.preventDefault();
    if (config === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const substance = buildTaskContractDraft(config.projectId, text);
      const created = await createTaskContractDraft(window.maestro.api, { projectId: config.projectId, substance });
      setDraft(created);
      setDraftForm(formFromContract(created));
      setConfirmed(false);
      setText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draft === undefined || draftForm === undefined || confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await updateTaskContractDraft(window.maestro.api, draft, {
        desiredOutcome: draftForm.desiredOutcome,
        successCriteria: lines(draftForm.successCriteria),
        project: {
          repository: draftForm.repository,
          immutableBaseRevision: draftForm.immutableBaseRevision,
          dataBoundary: draftForm.dataBoundary,
        },
      });
      setDraft(updated);
      setDraftForm(formFromContract(updated));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmDraft = async () => {
    if (draft === undefined || dirty || confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      await confirmTaskContractDraft(window.maestro.api, draft);
      setConfirmed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const launchDraft = async () => {
    if (draft === undefined || !confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      setDraft(await launchTaskContractDraft(window.maestro.api, draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home-main">
      <div className="home-title">{title}</div>
      <form className={`home-composer${isFlashmob ? " mode-flashmob" : ""}`} onSubmit={(event) => void submitBrief(event)}>
        <label className="sr-only" htmlFor="home-brief">Brief the Concertmaster</label>
        <textarea id="home-brief" placeholder="brief the concertmaster" value={text} onChange={(event) => setText(event.target.value)} />
        <div className="home-composer-row">
          <div className="pill-toggle" role="group" aria-label="Home mode">
            <button type="button" className={mode === "maestro" ? "on" : ""} onClick={() => onModeChange("maestro")}>maestro</button>
            <button type="button" className={isFlashmob ? "on flashmob" : ""} onClick={() => onModeChange("flashmob")}>flashmob</button>
          </div>
          <button className={`btn btn-primary btn-sm home-send-btn${isFlashmob ? " mode-flashmob" : ""}`} style={{ marginLeft: "auto" }} disabled={busy || text.trim() === ""} type="submit">
            {busy && draft === undefined ? "saving…" : "send"} <Icon name="send" style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </form>

      {error !== undefined && <div className="alert alert-warning home-authoring-error" role="alert">{error}</div>}

      {draft !== undefined && draftForm !== undefined && (
        <section className="home-draft" aria-labelledby="home-draft-title">
          <div className="home-draft-head">
            <div>
              <h2 id="home-draft-title">Task Contract draft</h2>
              <p>{draft.contractId} · v{draft.version} · {draft.launchState}{confirmed ? " · confirmation accepted" : ""}</p>
            </div>
            {draft.launchState === "awaiting_confirmation" && <span className="badge badge-ochre">draft</span>}
            {draft.launchState === "launched" && <span className="badge badge-olive">launched</span>}
          </div>
          <form onSubmit={(event) => void saveDraft(event)}>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-outcome">Desired outcome</label>
              <textarea id="draft-outcome" className="input textarea" value={draftForm.desiredOutcome} disabled={confirmed || busy} onChange={(event) => setDraftForm({ ...draftForm, desiredOutcome: event.target.value })} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-success">Success criteria (one per line)</label>
              <textarea id="draft-success" className="input textarea" value={draftForm.successCriteria} disabled={confirmed || busy} onChange={(event) => setDraftForm({ ...draftForm, successCriteria: event.target.value })} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-repository">Repository</label>
              <input id="draft-repository" className="input" value={draftForm.repository} disabled={confirmed || busy} onChange={(event) => setDraftForm({ ...draftForm, repository: event.target.value })} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-base-revision">Immutable base revision</label>
              <input id="draft-base-revision" className="input" value={draftForm.immutableBaseRevision} disabled={confirmed || busy} onChange={(event) => setDraftForm({ ...draftForm, immutableBaseRevision: event.target.value })} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="draft-boundary">Data boundary</label>
              <input id="draft-boundary" className="input" value={draftForm.dataBoundary} disabled={confirmed || busy} onChange={(event) => setDraftForm({ ...draftForm, dataBoundary: event.target.value })} />
            </div>
            <div className="home-draft-actions">
              <button className="btn" type="submit" disabled={busy || confirmed || !dirty}>save draft</button>
              <button className="btn btn-primary" type="button" disabled={busy || confirmed || dirty} onClick={() => void confirmDraft()}>confirm exact draft</button>
              <button className="btn" type="button" disabled={busy || !confirmed || draft.launchState === "launched"} onClick={() => void launchDraft()}>launch</button>
            </div>
          </form>
          <p className="form-hint">Confirmation only records the exact server version and content hash. Launch is a separate action.</p>
        </section>
      )}

      {!isFlashmob && draft === undefined && (
        <div className="home-cards">
          <div className="home-card" onClick={() => onNavigate("floor")}>
            <Icon name="chart-pie" />
            <div className="home-card-title">open floor view</div>
            <div className="home-card-sub">see the whole org work</div>
          </div>
          <div className="home-card" onClick={() => onNavigate("inbox")}>
            <Icon name="inbox" />
            <div className="home-card-title">inbox</div>
            <div className="home-card-sub">certifications for the selected Goal</div>
          </div>
        </div>
      )}

      {isFlashmob && draft === undefined && (
        <div className="home-suggestions show">
          {suggestions.map((suggestion) => (
            <button key={suggestion} className="chip" type="button" onClick={() => setText(suggestion)}>{suggestion}</button>
          ))}
        </div>
      )}
    </div>
  );
}
