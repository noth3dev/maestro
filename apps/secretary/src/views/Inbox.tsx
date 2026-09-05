import { useState } from "react";
import { Icon } from "../icons.js";
import type { ViewName } from "../views.js";

interface Message {
  who: "you" | "concertmaster";
  text: string;
}

interface PendingItem {
  id: string;
  title: string;
  sub: string;
  viewTarget: ViewName;
  opener: string;
}

const pendingItems: PendingItem[] = [
  {
    id: "engineering-approval",
    title: "engineering — approval needed",
    sub: "scout-1 requests write access outside allowlist: /repo/marketing/assets",
    viewTarget: "channel",
    opener: "scout-1 needs the assets folder to place the optimized hero images. want me to narrow the grant to read-only, or approve the write as scoped?",
  },
  {
    id: "billing-ceiling",
    title: "billing refactor — budget ceiling notice",
    sub: "department plan estimates 40% over goal budget",
    viewTarget: "dashboard",
    opener: "tech group is driving most of the overage — auth migration turned out more involved than the sealed brief estimated. raise the ceiling, or have me ask tech head to descope?",
  },
  {
    id: "docs-cleanup",
    title: "docs cleanup — critical action",
    sub: "worker-9 requests deletion of /docs/legacy (12 files)",
    viewTarget: "git",
    opener: "deletion is classified critical, so it needs your sign-off regardless. the 12 files were superseded by the new docs three weeks ago — worker-9's evidence bundle has the diff if you want to check first.",
  },
];

function DiscussThread({ opener }: { opener: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ who: "concertmaster", text: opener }]);
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setMessages((current) => [
      ...current,
      { who: "you", text },
      { who: "concertmaster", text: "noted — I'll factor that in. still your call on approve or deny above." },
    ]);
    setDraft("");
  };

  return (
    <>
      <button className="inbox-link" onClick={() => setOpen((current) => !current)}><Icon name="message-circle" /> discuss with concertmaster</button>
      <div className={`inbox-discuss${open ? " open" : ""}`}>
        <div className="inbox-discuss-msgs">
          {messages.map((message, index) => (
            <div key={index} className="msg">
              <div className={`avatar avatar-sm ${message.who === "you" ? "av-slate" : "av-terracotta"}`}>{message.who === "you" ? "you" : "CM"}</div>
              <div className="msg-body"><div className="msg-head"><span className="msg-name">{message.who === "you" ? "you" : "concertmaster"}</span></div><div className="msg-text">{message.text}</div></div>
            </div>
          ))}
        </div>
        <div className="inbox-discuss-row">
          <input className="input" type="text" placeholder="ask a follow-up" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} />
          <button className="btn btn-sm" onClick={send}>send</button>
        </div>
      </div>
    </>
  );
}

export function Inbox({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  return (
    <div className="inbox-main">
      <div className="dash-head" style={{ padding: "20px 20px 0" }}><div className="dash-title">inbox</div></div>
      <div className="dash-sub" style={{ padding: "0 20px 14px" }}>approvals waiting on you, plus recent certifications</div>
      <div className="inbox-list">
        {pendingItems.map((item) => (
          <div key={item.id} className="inbox-item pending">
            <div className="inbox-icon" style={{ background: "var(--ochre-bg)", color: "var(--ochre-text)" }}><Icon name="triangle-alert" /></div>
            <div className="inbox-body">
              <div className="inbox-title">{item.title}</div>
              <div className="inbox-sub">{item.sub}</div>
              <div className="inbox-actions">
                <button className="inbox-link" onClick={() => onNavigate(item.viewTarget)}><Icon name="external-link" /> view message</button>
                <DiscussThread opener={item.opener} />
                <span style={{ flex: 1 }} />
                <button className="btn btn-sm">deny</button>
                <button className="btn btn-primary btn-sm">approve</button>
              </div>
            </div>
          </div>
        ))}

        <div className="inbox-item info">
          <div className="inbox-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="check" /></div>
          <div className="inbox-body">
            <div className="inbox-title">launch page — hero section certified</div>
            <div className="inbox-sub">metronome · 2 hours ago</div>
            <div className="inbox-actions">
              <button className="inbox-link" onClick={() => onNavigate("git")}><Icon name="external-link" /> view message</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
