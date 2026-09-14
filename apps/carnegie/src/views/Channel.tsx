import React, { useEffect, useState } from "react";
import { CHANNEL_SELECTORS, type ChannelRead, type ChannelSelector } from "@maestro/api-client";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalDetail } from "../useGoalDetail.js";
import { useGoals } from "../goals.js";
import { loadChannel, postChannelMessage } from "../lib/channel-data.js";
import type { ViewName } from "../views.js";

const defaultSelector: ChannelSelector = { kind: "department", channelId: "engineering" };
const channelSelectors = CHANNEL_SELECTORS;

function selectorKey(selector: ChannelSelector): string {
  return `${selector.kind}:${selector.channelId}`;
}

export function Channel({ onNavigate: _onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const { detail, loading: detailLoading, error: detailError } = useGoalDetail();
  const [channel, setChannel] = useState<ChannelRead | undefined>(undefined);
  const [selector, setSelector] = useState<ChannelSelector>(defaultSelector);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [rosterHidden, setRosterHidden] = useState(false);

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
  }, [config, selectedGoalId, selector]);

  const send = async () => {
    if (config === undefined || selectedGoalId === undefined || content.trim() === "" || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await postChannelMessage(window.maestro.api, selectedGoalId, selector, config.projectId, content, crypto.randomUUID());
      setContent("");
      const refreshed = await loadChannel(window.maestro.api, selectedGoalId, selector, config.projectId);
      setChannel(refreshed);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not post message");
    } finally { setSending(false); }
  };

  if (config === undefined) return <EmptyState />;
  const displayError = error ?? detailError;
  return (
    <div className="channel-wrap" style={{ position: "relative" }}>
      <div className="channel-feed">
        <div className="channel-head">
          <Icon name="activity" /> {channel?.channel.displayName ?? `#${selector.channelId}`}
          <label className="channel-selector-label">Channel
            <select aria-label="Channel" value={selectorKey(selector)} onChange={(event) => {
              const next = channelSelectors.find((candidate) => selectorKey(candidate) === event.target.value);
              if (next !== undefined) { setChannel(undefined); setSelector(next); }
            }}>
              {channelSelectors.map((candidate) => <option key={selectorKey(candidate)} value={selectorKey(candidate)}>{`#${candidate.channelId}`}</option>)}
            </select>
          </label>
          <span className="goalname">{selectedGoalId ?? "no Goal selected"}</span>
          <div className="roster-toggle-btn" onClick={() => setRosterHidden((current) => !current)} title="toggle roster"><Icon name="panel-right" /></div>
        </div>
        <div className="channel-messages">
          {(loading || detailLoading) && <p>loading…</p>}
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
            <textarea className="chan-composer-input" placeholder={`Message #${selector.channelId}`} rows={1} value={content} disabled={sending || selectedGoalId === undefined} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            <button type="button" className="btn btn-primary" disabled={sending || content.trim() === "" || selectedGoalId === undefined} onClick={() => void send()}>{sending ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
      <div className={`roster${rosterHidden ? " hide" : ""}`}>
        <div className="roster-head">roster{channel === undefined ? "" : ` · ${channel.members.length}`}</div>
        {channel?.members.map((member) => <div key={`${member.identityKind}:${member.identityId}`} className="roster-item"><div className="avatar avatar-sm av-terracotta">{(member.departmentId?.slice(0, 2) ?? "OR").toUpperCase()}</div><span>{member.displayName}</span><span className="roster-role-badge">{member.identityKind}</span><div className={`roster-dot ${member.status === "active" || member.status === "running" || member.status === "spawned" || member.status === "standing" ? "dot-active" : "dot-idle"}`} /></div>)}
        {channel !== undefined && channel.members.length === 0 && <EmptyState title="No active roster" hint="The live Goal roster has no active members in this channel." />}
      </div>
    </div>
  );
}
