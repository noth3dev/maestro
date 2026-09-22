import React, { useEffect, useRef, useState } from "react";
import { CHANNEL_SELECTORS, type ChannelRead, type ChannelSelector } from "@maestro/api-client";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalWorkers } from "../useGoalWorkers.js";
import { Workers } from "./Workers.js";
import type { MissionBundle } from "@maestro/contracts";
import { useGoalDetail } from "../useGoalDetail.js";
import { useGoals } from "../goals.js";
import { createChannelMessageAttempt, loadChannel, postChannelMessage, type ChannelMessageAttempt } from "../lib/channel-data.js";
import { missionBundleMatchesWorker } from "../lib/worker-data.js";
import type { ViewName } from "../views.js";

const defaultSelector: ChannelSelector = { kind: "department", channelId: "engineering" };
const channelSelectors = CHANNEL_SELECTORS;

function selectorKey(selector: ChannelSelector): string {
  return `${selector.kind}:${selector.channelId}`;
}

export function Channel({ onNavigate: _onNavigate, eventCursor = "0" }: { onNavigate: (view: ViewName) => void; eventCursor?: string }) {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [workerRefreshKey, setWorkerRefreshKey] = useState(0);
  const { workers, loading: workersLoading, error: workersError } = useGoalWorkers(`${eventCursor}:${workerRefreshKey}`);
  const { detail, loading: detailLoading, error: detailError } = useGoalDetail();
  const [channel, setChannel] = useState<ChannelRead | undefined>(undefined);
  const [selector, setSelector] = useState<ChannelSelector>(defaultSelector);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [rosterHidden, setRosterHidden] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>(undefined);
  const [missionBundle, setMissionBundle] = useState<MissionBundle | undefined>(undefined);
  const pendingMessageRef = useRef<ChannelMessageAttempt | undefined>(undefined);
  const channelScopeRef = useRef("");

  useEffect(() => {
    channelScopeRef.current = `${config?.projectId ?? ""}:${selectedGoalId ?? ""}:${selectorKey(selector)}`;
    setSelectedWorkerId(undefined);
    setMissionBundle(undefined);
    pendingMessageRef.current = undefined;
  }, [config, selectedGoalId, selector]);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) {
      setChannel(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loadChannel(window.maestro.api, selectedGoalId, selector, config.projectId)
      .then((result) => { if (!cancelled) setChannel(result); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load channel"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [config, selectedGoalId, selector, eventCursor]);

  useEffect(() => {
    if (config === undefined || selectedWorkerId === undefined || workers === undefined) {
      setMissionBundle(undefined);
      return;
    }
    const worker = workers.find((candidate) => candidate.workerId === selectedWorkerId);
    if (worker === undefined) {
      setSelectedWorkerId(undefined);
      setMissionBundle(undefined);
      return;
    }
    let cancelled = false;
    setMissionBundle(undefined);
    void window.maestro.api
      .getMissionBundle(worker.councilId, worker.departmentId, worker.planVersion, worker.itemId, config.projectId)
      .then((bundle) => {
        if (cancelled) return;
        if (!missionBundleMatchesWorker(bundle, worker)) {
          setError("The loaded Mission Bundle does not match the selected Worker.");
          setMissionBundle(undefined);
          return;
        }
        setMissionBundle(bundle);
      })
      .catch(() => { if (!cancelled) setMissionBundle(undefined); });
    return () => { cancelled = true; };
  }, [config, selectedWorkerId, workers]);

  const send = async () => {
    if (config === undefined || selectedGoalId === undefined || content.trim() === "" || sending) return;
    const scopeAtSend = `${config.projectId}:${selectedGoalId}:${selectorKey(selector)}`;
    const attempt = createChannelMessageAttempt(content, pendingMessageRef.current);
    pendingMessageRef.current = attempt;
    setSending(true);
    setError(undefined);
    try {
      await postChannelMessage(window.maestro.api, selectedGoalId, selector, config.projectId, attempt.content, attempt.commandId);
    } catch (cause: unknown) {
      // Keep the draft and command ID so a retry can safely replay the same
      // idempotent request. Editing the draft creates a fresh attempt below.
      if (channelScopeRef.current === scopeAtSend) setError(cause instanceof Error ? cause.message : "Could not post message");
      setSending(false);
      return;
    }
    if (channelScopeRef.current !== scopeAtSend) {
      setSending(false);
      return;
    }
    setContent("");
    pendingMessageRef.current = undefined;
    try {
      const refreshed = await loadChannel(window.maestro.api, selectedGoalId, selector, config.projectId);
      if (channelScopeRef.current === scopeAtSend) setChannel(refreshed);
    } catch (cause: unknown) {
      if (channelScopeRef.current === scopeAtSend) setError(cause instanceof Error ? cause.message : "Message sent, but the channel could not be refreshed");
    } finally { setSending(false); }
  };

  if (config === undefined) return <EmptyState />;
  const displayError = error ?? detailError ?? workersError;
  return (
    <div className="channel-wrap" style={{ position: "relative" }}>
      <div className="channel-feed">
        <div className="channel-head">
          <Icon name="activity" /> {channel?.channel.displayName ?? `#${selector.channelId}`}
          <label className="channel-selector-label">Channel
            <select aria-label="Channel" value={selectorKey(selector)} onChange={(event) => {
              const next = channelSelectors.find((candidate) => selectorKey(candidate) === event.target.value);
              if (next !== undefined) { setChannel(undefined); setSelectedWorkerId(undefined); setMissionBundle(undefined); setSelector(next); }
            }}>
              {channelSelectors.map((candidate) => <option key={selectorKey(candidate)} value={selectorKey(candidate)}>{`#${candidate.channelId}`}</option>)}
            </select>
          </label>
          <span className="goalname">{selectedGoalId ?? "no Goal selected"}</span>
          <button type="button" className="roster-toggle-btn" onClick={() => setRosterHidden((current) => !current)} aria-label={rosterHidden ? "Show roster" : "Hide roster"}><Icon name="panel-right" /></button>
        </div>
        <div className="channel-messages">
          {(loading || detailLoading || workersLoading) && <p>{workersLoading && workers !== undefined ? "refreshing Worker roster; showing last durable state…" : "loading…"}</p>}
          {displayError !== undefined && <div className="alert alert-warning">{displayError}</div>}
          {channel?.messages.map((message) => (
            <div key={message.messageId} className="msg">
              <div className="avatar avatar-sm av-teal"><Icon name="message-circle" style={{ width: 14, height: 14 }} /></div>
              <div className="msg-body">
                <div className="msg-head"><span className="msg-name">{message.author.kind === "operator" ? "You" : message.author.id}</span><span className="msg-time">{new Date(message.createdAt).toLocaleString()}</span></div>
                <div className="msg-text">{message.content}</div>
              </div>
            </div>
          ))}
          {!loading && channel !== undefined && channel.messages.length === 0 && <p>No messages in this channel yet.</p>}
          {detail?.events.slice(-10).map((event) => (
            <div key={event.eventId} className="msg">
              <div className="avatar avatar-sm av-teal"><Icon name="zap" style={{ width: 14, height: 14 }} /></div>
              <div className="msg-body"><div className="msg-head"><span className="msg-name">{event.eventType}</span><span className="msg-time">{new Date(event.occurredAt).toLocaleString()}</span></div><div className="msg-text">durable Goal event · cursor {event.cursor}</div></div>
            </div>
          ))}
          {selectedGoalId === undefined && !loading && <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard to use a Department channel." />}
        </div>
        <div className="channel-input">
          <div className="chan-composer">
            <textarea
              className="chan-composer-input"
              aria-label={`Message #${selector.channelId}`}
              placeholder={`Message #${selector.channelId}`}
              rows={1}
              value={content}
              disabled={sending || selectedGoalId === undefined}
              onChange={(event) => {
                const next = event.target.value;
                setContent(next);
                if (pendingMessageRef.current?.content !== next.trim()) pendingMessageRef.current = undefined;
              }}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
            />
            <button type="button" className="btn btn-primary" disabled={sending || content.trim() === "" || selectedGoalId === undefined} onClick={() => void send()}>{sending ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
      <div className={`roster${rosterHidden ? " hide" : ""}`}>
        {selectedWorkerId !== undefined && selectedGoalId !== undefined && config !== undefined ? (
          <Workers
            api={window.maestro.api}
            projectId={config.projectId}
            goalId={selectedGoalId}
            workers={workers ?? []}
            missionBundle={missionBundle}
            selectedWorkerId={selectedWorkerId}
            channelName={channel?.channel.displayName ?? `#${selector.channelId}`}
            onOpenChannel={() => setSelectedWorkerId(undefined)}
            onSelectWorker={(workerId) => { setSelectedWorkerId(workerId); setMissionBundle(undefined); }}
            onRefresh={() => setWorkerRefreshKey((current) => current + 1)}
          />
        ) : (
          <>
            <div className="roster-head">roster{channel === undefined ? "" : ` · ${channel.members.length}`}</div>
            {channel?.members.map((member) => {
              const isWorker = member.identityKind === "worker";
              const content = <><div className="avatar avatar-sm av-terracotta">{(member.departmentId?.slice(0, 2) ?? "OR").toUpperCase()}</div><span>{member.displayName}</span><span className="roster-role-badge">{member.identityKind}</span><div className={`roster-dot ${member.status === "active" || member.status === "running" || member.status === "spawned" || member.status === "standing" ? "dot-active" : "dot-idle"}`} /></>;
              return isWorker ? <button key={`${member.identityKind}:${member.identityId}`} type="button" className="roster-item" onClick={() => { setRosterHidden(false); setSelectedWorkerId(member.identityId); }}>{content}</button> : <div key={`${member.identityKind}:${member.identityId}`} className="roster-item">{content}</div>;
            })}
            {channel !== undefined && channel.members.length === 0 && <EmptyState title="No active roster" hint="The live Goal roster has no active members in this channel." />}
          </>
        )}
      </div>
    </div>
  );
}
