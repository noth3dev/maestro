import { useState } from "react";
import { Icon } from "../icons.js";
import type { ViewName } from "../views.js";
import type { HomeMode } from "../homeMode.js";

const homeTitles = [
  "what should the floor work on",
  "give the floor a brief",
  "what needs the orchestra today",
  "what should the concertmaster take on",
];

const suggestions = ["fix the pricing page copy", "audit the auth flow for gaps", "clean up legacy docs"];

export function Home({ onNavigate, mode, onModeChange }: { onNavigate: (view: ViewName) => void; mode: HomeMode; onModeChange: (mode: HomeMode) => void }) {
  const [title] = useState(() => homeTitles[Math.floor(Math.random() * homeTitles.length)]);
  const [text, setText] = useState("");
  const isFlashmob = mode === "flashmob";

  return (
    <div className="home-main">
      <div className="home-title">{title}</div>
      <div className={`home-composer${isFlashmob ? " mode-flashmob" : ""}`}>
        <textarea placeholder="brief the concertmaster" value={text} onChange={(event) => setText(event.target.value)} />
        <div className="home-composer-row">
          <div className="pill-toggle">
            <div className={mode === "maestro" ? "on" : ""} onClick={() => onModeChange("maestro")}>maestro</div>
            <div className={isFlashmob ? "on flashmob" : ""} onClick={() => onModeChange("flashmob")}>flashmob</div>
          </div>
          <button className={`btn btn-primary btn-sm home-send-btn${isFlashmob ? " mode-flashmob" : ""}`} style={{ marginLeft: "auto" }}>
            send <Icon name="send" style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>

      {isFlashmob ? (
        <div className="home-suggestions show">
          {suggestions.map((suggestion) => (
            <div key={suggestion} className="chip" onClick={() => setText(suggestion)}>{suggestion}</div>
          ))}
        </div>
      ) : (
        <div className="home-cards">
          <div className="home-card" onClick={() => onNavigate("floor")}>
            <Icon name="chart-pie" />
            <div className="home-card-title">open floor view</div>
            <div className="home-card-sub">see the whole org work</div>
          </div>
          <div className="home-card" onClick={() => onNavigate("inbox")}>
            <Icon name="inbox" />
            <div className="home-card-title">3 pending approvals</div>
            <div className="home-card-sub">waiting on you</div>
          </div>
        </div>
      )}
    </div>
  );
}
