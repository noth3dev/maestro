import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, OvertureMessage, OvertureRun } from "@maestro/contracts";
import { Icon } from "../icons.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { useSessions } from "../sessions.js";
import { MarkdownView } from "../components/MarkdownView.js";
import { FilePanel } from "../components/FilePanel.js";
import { TaskContractActions } from "../components/TaskContractActions.js";
import { ConversationTurnError, submitHomeBrief } from "../lib/task-contract-authoring.js";
import { cancelHomeTurn, loadConversation, type ConversationMessage } from "../lib/conversation-data.js";
import {
  buildSessionTimeline,
  overtureRoleLabel,
  projectOpenOvertureClarification,
  type OvertureClarificationView,
  type TimelineItem,
} from "../lib/session-timeline.js";

const overtureRoles = [
  "conversation-lead",
  "architecture-analyst",
  "external-research-scout",
  "security-evaluator",
  "design-mock-specialist",
  "task-editor",
] as const;

const POLL_MS = 2000;

export type SessionStart = { text: string; modelRef: string; reasoningEffort?: string };

type Busy = "concertmaster" | "overture" | undefined;

export function ConcertmasterSession({
  conversationId,
  start,
  onStarted,
}: {
  /** The session to show; undefined while `start` is creating a new one. */
  conversationId: string | undefined;
  start?: SessionStart;
  onStarted: (conversationId: string) => void;
}) {
  const { config } = useConnection();
  const projectId = config?.projectId;
  const { selectedGoalId } = useGoals();
  const { sessions, refresh: refreshSessions } = useSessions();
  const ownId = useRef<string | undefined>(conversationId);
  const [loadedId, setLoadedId] = useState<string | undefined>(conversationId);
  const [conversation, setConversation] = useState<Conversation | undefined>(undefined);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pending, setPending] = useState<TimelineItem[]>([]);
  const [overtureRun, setOvertureRun] = useState<OvertureRun | undefined>(undefined);
  const [overtureMessages, setOvertureMessages] = useState<readonly OvertureMessage[]>([]);
  const [clarification, setClarification] = useState<OvertureClarificationView | undefined>(undefined);
  const [workspacePaths, setWorkspacePaths] = useState<readonly string[] | undefined>(undefined);
  const [workspaceRevision, setWorkspaceRevision] = useState<string | undefined>(undefined);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(undefined);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastText, setLastText] = useState<string | undefined>(undefined);
  const [text, setText] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const panelAutoOpened = useRef(false);

  const refreshOverture = useCallback(
    async (id: string, knownRun?: OvertureRun) => {
      if (projectId === undefined) return;
      const run = knownRun ?? (await window.maestro.api.listOvertureRuns({ projectId, conversationId: id })).at(-1);
      if (run === undefined) return;
      const query = { projectId, conversationId: id };
      const [latestRun, overtureList, events] = await Promise.all([
        window.maestro.api.getOvertureRun(run.runId, query),
        window.maestro.api.listOvertureMessages(run.runId, { ...query, afterCursor: "0" }),
        window.maestro.api.listOvertureEvents(run.runId, { ...query, afterCursor: "0" }),
      ]);
      if (ownId.current !== id) return;
      setOvertureRun(latestRun);
      setOvertureMessages(overtureList);
      setClarification(projectOpenOvertureClarification(events));
    },
    [projectId],
  );

  const refreshWorkspace = useCallback(
    async (id: string) => {
      if (projectId === undefined) return;
      const listing = await window.maestro.api.listSessionWorkspaceFiles(id, { projectId });
      if (ownId.current !== id) return;
      setWorkspacePaths(listing.files.map((file) => file.path));
      setWorkspaceRevision(listing.revision ?? undefined);
      if (listing.files.length > 0 && !panelAutoOpened.current) {
        panelAutoOpened.current = true;
        setPanelOpen(true);
      }
    },
    [projectId],
  );

  const refreshMessages = useCallback(
    async (id: string) => {
      if (projectId === undefined) return;
      const loaded = await loadConversation(window.maestro.api, { conversationId: id, projectId });
      if (ownId.current !== id) return;
      setMessages(loaded);
    },
    [projectId],
  );

  // Switch sessions when the sidebar opens a different one.
  useEffect(() => {
    if (conversationId === ownId.current && loadedId === conversationId) return;
    ownId.current = conversationId;
    setLoadedId(conversationId);
    setConversation(undefined);
    setMessages([]);
    setPending([]);
    setOvertureRun(undefined);
    setOvertureMessages([]);
    setClarification(undefined);
    setWorkspacePaths(undefined);
    setWorkspaceRevision(undefined);
    setPanelOpen(false);
    panelAutoOpened.current = false;
    setError(undefined);
    setText("");
    if (conversationId === undefined || projectId === undefined) return;
    const id = conversationId;
    void Promise.all([
      window.maestro.api.getConversation(id, { projectId }).then((value) => { if (ownId.current === id) setConversation(value); }),
      refreshMessages(id),
      refreshOverture(id),
      refreshWorkspace(id).catch(() => undefined),
    ]).catch((cause: unknown) => { if (ownId.current === id) setError(cause instanceof Error ? cause.message : String(cause)); });
  }, [conversationId, loadedId, projectId, refreshMessages, refreshOverture, refreshWorkspace]);

  // Keep Overture replies, questions, and workspace files live.
  useEffect(() => {
    const id = loadedId;
    if (id === undefined) return;
    const timer = window.setInterval(() => {
      void refreshOverture(id, overtureRun).catch(() => undefined);
      void refreshWorkspace(id).catch(() => undefined);
      if (busy === undefined) void refreshMessages(id).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, loadedId, overtureRun, refreshMessages, refreshOverture, refreshWorkspace]);

  const send = useCallback(
    async (input: string, first?: SessionStart) => {
      if (projectId === undefined) return;
      const content = input.trim();
      if (content === "") return;
      setError(undefined);
      setLastText(content);
      setPending((current) => [...current, { id: `pending-${Date.now()}`, author: "operator", content, createdAt: new Date().toISOString(), pending: true }]);

      const id = ownId.current;
      if (id !== undefined && overtureRun !== undefined && clarification !== undefined) {
        setBusy("overture");
        try {
          await window.maestro.api.answerOvertureClarification(
            overtureRun.runId,
            clarification.clarificationId,
            { projectId, conversationId: id, answer: content },
            { idempotencyKey: globalThis.crypto.randomUUID() },
          );
          setClarification(undefined);
          await refreshOverture(id, overtureRun);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(undefined);
        }
        return;
      }

      setBusy("concertmaster");
      let conversationKey = id;
      try {
        const intake = await submitHomeBrief(window.maestro.api, {
          projectId,
          text: content,
          selectedGoalId,
          ...(id === undefined && first !== undefined ? { modelRef: first.modelRef } : {}),
          ...(id === undefined && first?.reasoningEffort !== undefined ? { reasoningEffort: first.reasoningEffort } : {}),
          ...(id === undefined ? {} : { conversationId: id }),
          onConversationCreated: (createdId) => {
            ownId.current = createdId;
            conversationKey = createdId;
            setLoadedId(createdId);
            onStarted(createdId);
          },
        });
        conversationKey = intake.conversationId ?? conversationKey;
        if (conversationKey === undefined) return;
        const key = conversationKey;
        await Promise.all([
          refreshMessages(key),
          window.maestro.api.getConversation(key, { projectId }).then(setConversation),
        ]);
        setPending([]);
        void refreshSessions();
        if (intake.turnStatus !== "completed" || intake.turnId === undefined) return;

        setBusy("overture");
        let run = overtureRun;
        if (run === undefined) {
          run = await window.maestro.api.createOvertureRun(
            { runId: globalThis.crypto.randomUUID(), projectId, conversationId: key, roles: [...overtureRoles] },
            { idempotencyKey: globalThis.crypto.randomUUID() },
          );
          setOvertureRun(run);
        }
        await window.maestro.api.sendOvertureOperatorMessage(
          run.runId,
          { projectId, conversationId: key, turnId: intake.turnId, content },
          { idempotencyKey: globalThis.crypto.randomUUID() },
        );
        await refreshOverture(key, run);
      } catch (cause) {
        if (cause instanceof ConversationTurnError && ownId.current === undefined) {
          ownId.current = cause.conversationId;
          setLoadedId(cause.conversationId);
          onStarted(cause.conversationId);
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(undefined);
      }
    },
    [clarification, onStarted, overtureRun, projectId, refreshMessages, refreshOverture, refreshSessions, selectedGoalId],
  );

  // A new session starts from the landing brief exactly once.
  useEffect(() => {
    if (start === undefined || started.current || conversationId !== undefined) return;
    started.current = true;
    void send(start.text, start);
  }, [conversationId, send, start]);

  // Crew turns run in the background; the latest Overture message being the
  // operator's means a reply is still on its way.
  const overtureWorking = overtureMessages.at(-1)?.actor === "operator";
  const timeline = useMemo(() => buildSessionTimeline(messages, overtureMessages, pending), [messages, overtureMessages, pending]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [timeline.length, busy, clarification, overtureWorking]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy !== undefined) return;
    const value = text;
    setText("");
    void send(value);
  };

  const cancel = async () => {
    const id = ownId.current;
    if (projectId === undefined || id === undefined) return;
    setCancelBusy(true);
    const result = await cancelHomeTurn(window.maestro.api, { conversationId: id, projectId });
    if (result.error !== undefined) setError(result.error);
    setCancelBusy(false);
  };

  const loadWorkspaceFile = useCallback(
    async (path: string) => {
      const id = ownId.current;
      if (projectId === undefined || id === undefined) throw new Error("Session is not open");
      return (await window.maestro.api.readSessionWorkspaceFile(id, { projectId, path })).content;
    },
    [projectId],
  );

  const summary = sessions?.find((session) => session.conversationId === loadedId);
  const title = summary?.title ?? timeline.find((item) => item.author === "operator")?.content ?? "new session";

  return (
    <div className={`cm-session${panelOpen ? " with-panel" : ""}`}>
      <section className="cm-chat" aria-label="Concertmaster session">
        <header className="cm-head">
          <h1 className="cm-title" title={title}>{title}</h1>
          {conversation !== undefined && <span className="badge">{conversation.model}</span>}
          {overtureRun !== undefined && <span className="badge badge-slate">overture · {overtureRun.state.replaceAll("_", " ")}</span>}
          <button
            type="button"
            className={`btn btn-sm cm-panel-toggle${panelOpen ? " on" : ""}`}
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((current) => !current)}
          >
            <Icon name="panel-right" /> workspace{workspacePaths !== undefined && workspacePaths.length > 0 ? ` · ${workspacePaths.length}` : ""}
          </button>
        </header>
        <div className="cm-log" role="log" aria-live="polite" aria-label="Session messages">
          {timeline.map((item) => (
            <article key={item.id} className={`cm-msg cm-${item.author}${item.pending ? " is-pending" : ""}`}>
              <div className="cm-msg-author">
                {item.author === "operator" ? "you" : item.author === "overture" ? `overture · ${overtureRoleLabel(item.role)}` : item.author}
              </div>
              <div className="cm-msg-body">
                {item.author === "operator" ? <p className="cm-plain">{item.content}</p> : <MarkdownView source={item.content} />}
              </div>
            </article>
          ))}
          {clarification !== undefined && (
            <article className="cm-msg cm-overture cm-question">
              <div className="cm-msg-author">overture · question</div>
              <div className="cm-msg-body">
                <p className="cm-plain">{clarification.question}</p>
                <p className="form-hint">Your next message answers this question.</p>
              </div>
            </article>
          )}
          {(busy !== undefined || overtureWorking) && (
            <p className="cm-typing" role="status">
              {busy === "concertmaster" ? "Concertmaster is replying…" : "Overture crew is working…"}
            </p>
          )}
          {error !== undefined && (
            <div className="alert alert-warning cm-error" role="alert">
              <span>{error}</span>
              {lastText !== undefined && busy === undefined && (
                <button type="button" className="btn btn-sm" onClick={() => { setPending([]); void send(lastText); }}>retry</button>
              )}
            </div>
          )}
          <div ref={logEnd} />
        </div>
        <form className="cm-composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="cm-input">Message the Concertmaster</label>
          <textarea
            id="cm-input"
            rows={2}
            value={text}
            placeholder={clarification !== undefined ? "answer Overture's question" : "message the concertmaster"}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {busy === "concertmaster" ? (
            <button type="button" className="btn btn-sm" disabled={cancelBusy} onClick={() => void cancel()}>
              {cancelBusy ? "cancelling…" : "cancel"}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== undefined || text.trim() === ""}>
              send <Icon name="send" style={{ width: 12, height: 12 }} />
            </button>
          )}
        </form>
      </section>
      {panelOpen && (
        <FilePanel
          title="session workspace"
          paths={workspacePaths}
          loadFile={loadWorkspaceFile}
          {...(workspaceRevision === undefined ? {} : { refreshKey: workspaceRevision })}
          emptyHint="Files the Overture crew writes for this session appear here."
          onClose={() => setPanelOpen(false)}
          renderFileActions={(path) =>
            path === "task.md" && projectId !== undefined ? (
              <TaskContractActions
                projectId={projectId}
                run={overtureRun}
                revision={workspaceRevision}
                onChanged={() => { if (loadedId !== undefined) void refreshOverture(loadedId).catch(() => undefined); }}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
