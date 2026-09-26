import React, { useEffect, useState } from "react";
import type { ModelCatalogEntry } from "@maestro/contracts";
import { Icon } from "../icons.js";
import { ReasoningDial, defaultReasoningEffort } from "../components/ReasoningDial.js";
import { ProviderSignIn } from "../components/ProviderSignIn.js";
import { useConnection } from "../connection.js";
import { useSessions } from "../sessions.js";
import type { ViewName } from "../views.js";
import type { HomeMode } from "../homeMode.js";
import { modelRef, readSavedConcertmasterModelRef, resolveDefaultModelRef, saveConcertmasterModelRef, sortLiveModels } from "../lib/concertmaster-model.js";
import { ConcertmasterSession, type SessionStart } from "./ConcertmasterSession.js";

const homeTitles = [
  "what should the floor work on",
  "give the floor a brief",
  "what needs the orchestra today",
  "what should the concertmaster take on",
];

export function submitHomeComposer(mode: HomeMode, event: Pick<React.FormEvent, "preventDefault">, submit: () => void): void {
  event.preventDefault();
  if (mode === "flashmob") return;
  submit();
}

/**
 * The Concertmaster entry point: a landing composer for a new session, which
 * turns into the chat session view as soon as a brief is sent or a session is
 * opened from the sidebar.
 */
export function Home({
  onNavigate,
  mode,
  onModeChange,
}: {
  onNavigate: (view: ViewName) => void;
  mode: HomeMode;
  onModeChange: (mode: HomeMode) => void;
}) {
  const { activeConversationId, openSession, newSessionRequest } = useSessions();
  const [start, setStart] = useState<SessionStart | undefined>(undefined);

  useEffect(() => {
    setStart(undefined);
  }, [newSessionRequest]);

  if (activeConversationId !== undefined || start !== undefined) {
    return (
      <ConcertmasterSession
        conversationId={activeConversationId}
        {...(start === undefined ? {} : { start })}
        onStarted={(conversationId) => {
          openSession(conversationId);
          setStart(undefined);
        }}
      />
    );
  }
  return <HomeLanding onNavigate={onNavigate} mode={mode} onModeChange={onModeChange} onStart={setStart} />;
}

function HomeLanding({
  onNavigate,
  mode,
  onModeChange,
  onStart,
}: {
  onNavigate: (view: ViewName) => void;
  mode: HomeMode;
  onModeChange: (mode: HomeMode) => void;
  onStart: (start: SessionStart) => void;
}) {
  const { config } = useConnection();
  const projectId = config?.projectId;
  const [title] = useState(() => homeTitles[Math.floor(Math.random() * homeTitles.length)]);
  const [text, setText] = useState("");
  const [models, setModels] = useState<readonly ModelCatalogEntry[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | undefined>(undefined);
  const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(undefined);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | undefined>(undefined);
  const [modelsReload, setModelsReload] = useState(0);
  const isFlashmob = mode === "flashmob";
  const selectedModel = models.find((model) => modelRef(model) === selectedRef);

  useEffect(() => {
    if (projectId === undefined) return;
    let current = true;
    setModelsLoading(true);
    setModelsError(undefined);
    void window.maestro.api
      .listModels()
      .then((loaded) => {
        if (!current) return;
        const sorted = sortLiveModels(loaded);
        setModels(sorted);
        const selected = resolveDefaultModelRef(sorted, readSavedConcertmasterModelRef(projectId));
        setSelectedRef(selected);
        setReasoningEffort(defaultReasoningEffort(sorted.find((model) => modelRef(model) === selected)));
        if (selected === undefined) setModelsError("No live Concertmaster models are available.");
      })
      .catch((cause) => {
        if (current) setModelsError(cause instanceof Error ? cause.message : "Could not load live Concertmaster models.");
      })
      .finally(() => {
        if (current) setModelsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [projectId, modelsReload]);

  const submit = (event: React.FormEvent) => {
    submitHomeComposer(mode, event, () => {
      const brief = text.trim();
      if (brief === "" || selectedRef === undefined) return;
      onStart({ text: brief, modelRef: selectedRef, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) });
    });
  };

  return (
    <div className="home-main">
      <div className="home-title">{title}</div>
      {!modelsLoading && models.length === 0 && !isFlashmob && <ProviderSignIn onConnected={() => setModelsReload((current) => current + 1)} />}
      <form className={`home-composer${isFlashmob ? " mode-flashmob" : ""}`} onSubmit={submit}>
        <label className="sr-only" htmlFor="home-brief">
          Brief the Concertmaster
        </label>
        <textarea
          id="home-brief"
          placeholder={isFlashmob ? "Flashmob is deferred until its durable backend contract exists." : "brief the concertmaster"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={isFlashmob}
          aria-describedby={isFlashmob ? "home-flashmob-hint" : undefined}
        />
        <div className="home-composer-row">
          <div className="home-model-picker">
            <label htmlFor="home-concertmaster-model">Concertmaster model</label>
            <select
              id="home-concertmaster-model"
              value={selectedRef ?? ""}
              disabled={isFlashmob || modelsLoading || models.length === 0}
              onChange={(event) => {
                const next = event.target.value;
                setSelectedRef(next === "" ? undefined : next);
                if (projectId !== undefined && next !== "") saveConcertmasterModelRef(projectId, next);
                setReasoningEffort(defaultReasoningEffort(models.find((model) => modelRef(model) === next)));
              }}
              aria-describedby="home-concertmaster-model-hint"
            >
              {selectedRef === undefined && (
                <option value="" disabled>
                  {modelsLoading ? "loading models…" : (modelsError ?? "no live models")}
                </option>
              )}
              {models.map((model) => (
                <option key={modelRef(model)} value={modelRef(model)}>
                  {modelRef(model)}
                </option>
              ))}
            </select>
            <span id="home-concertmaster-model-hint" className="form-hint">
              Choose the model for this new Concertmaster session.
            </span>
          </div>
          <ReasoningDial model={selectedModel} value={reasoningEffort} onChange={setReasoningEffort} disabled={isFlashmob} id="home-reasoning-effort" />
          <div className="pill-toggle" role="group" aria-label="Home mode">
            <button type="button" className={mode === "maestro" ? "on" : ""} aria-pressed={mode === "maestro"} onClick={() => onModeChange("maestro")}>
              maestro
            </button>
            <button type="button" className={isFlashmob ? "on flashmob" : ""} aria-pressed={isFlashmob} onClick={() => onModeChange("flashmob")}>
              flashmob
            </button>
          </div>
          <button
            className={`btn btn-primary btn-sm home-send-btn${isFlashmob ? " mode-flashmob" : ""}`}
            disabled={isFlashmob || text.trim() === "" || selectedRef === undefined}
            type="submit"
          >
            send <Icon name="send" style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </form>

      {!isFlashmob && (
        <div className="home-cards">
          <button type="button" className="home-card" onClick={() => onNavigate("floor")}>
            <Icon name="chart-pie" aria-hidden="true" />
            <span className="home-card-title">open floor view</span>
            <span className="home-card-sub">see the whole org work</span>
          </button>
          <button type="button" className="home-card" onClick={() => onNavigate("inbox")}>
            <Icon name="inbox" aria-hidden="true" />
            <span className="home-card-title">inbox</span>
            <span className="home-card-sub">certifications for the selected Goal</span>
          </button>
        </div>
      )}

      {isFlashmob && (
        <section className="home-deferred-state" id="home-flashmob-hint" aria-label="Flashmob deferred state">
          <span className="badge badge-slate">out-of-scope</span>
          <h2>Flashmob is deferred</h2>
          <p>This mode cannot create a session, Worker, Goal, or progress locally. Use maestro for the live Concertmaster path.</p>
          <p className="form-hint">Flashmob can re-enter after Act 1 certification and a durable Act 2 backend contract.</p>
        </section>
      )}
    </div>
  );
}
