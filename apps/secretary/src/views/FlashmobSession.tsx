import { useState } from "react";
import { Icon } from "../icons.js";

export function FlashmobSession({ onBack, onPromote }: { onBack: () => void; onPromote: () => void }) {
  const [promoted, setPromoted] = useState(false);

  const promote = () => {
    setPromoted(true);
    onPromote();
  };

  return (
    <div className="fm-thread">
      <div className="fm-thread-head">
        <div className="fm-thread-back" onClick={onBack}><Icon name="arrow-left" /> flashmob</div>
        <div className="fm-thread-title">fix the pricing page copy</div>
        <span className="badge badge-olive" style={{ marginLeft: 4 }}>active</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={promoted} onClick={promote}>
          {promoted ? <><Icon name="check" style={{ width: 12, height: 12 }} /> promoted</> : <><Icon name="arrow-up-right" style={{ width: 12, height: 12 }} /> promote to goal</>}
        </button>
      </div>
      <div className="fm-thread-messages">
        <div className="msg">
          <div className="avatar avatar-sm av-slate">ND</div>
          <div className="msg-body"><div className="msg-head"><span className="msg-name">you</span></div><div className="msg-text">the pricing page copy is stale, the enterprise tier still says "coming soon". fix it.</div></div>
        </div>
        <div className="msg">
          <div className="avatar avatar-sm" style={{ background: "var(--p-blue-bg)", color: "var(--p-blue-text)" }}>FM</div>
          <div className="msg-body"><div className="msg-head"><span className="msg-name">flashmob worker</span></div><div className="msg-text">found it in /marketing/pricing.tsx. updating the enterprise tier copy and removing the "coming soon" badge now.</div></div>
        </div>
        <div className="msg">
          <div className="avatar avatar-sm" style={{ background: "var(--p-blue-bg)", color: "var(--p-blue-text)" }}>FM</div>
          <div className="msg-body"><div className="msg-head"><span className="msg-name">flashmob worker</span></div><div className="msg-text">done. small patch, within the allowlisted path — auto-accepted under policy.</div></div>
        </div>
      </div>
      <div className="channel-input">
        <div className="chan-composer">
          <textarea className="chan-composer-input" placeholder="message this session" rows={1} />
          <div className="chan-composer-toolbar">
            <div className="chan-composer-actions">
              <button className="btn-icon" title="attach file"><Icon name="paperclip" /></button>
            </div>
            <button className="chan-composer-send ready"><Icon name="send" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
