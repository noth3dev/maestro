import React, { useState } from "react";
import { EmptyState } from "../components/EmptyState.js";

function RegistryUnavailable({ kind }: { kind: "skill" | "tool" }) {
  return (
    <div className="page-body workspace-view-body">
      <EmptyState
        title={`No durable ${kind} registry is available`}
        hint={`The control plane does not durably track ${kind} definitions, tags, certification state, or usage counts yet.`}
      />
    </div>
  );
}

export function Luthiery({ initialTab = "skills" }: { initialTab?: "skills" | "tools" } = {}) {
  const [tab, setTab] = useState<"skills" | "tools">(initialTab);

  return (
    <div className="workspace-view">
      <header className="workspace-view-head">
        <div className="dash-kicker">workshop</div>
        <h1 className="dash-title">luthiery</h1>
        <p className="dash-sub">Tool and skill workshop. Durable registry is unavailable.</p>
      </header>
      <div className="page-tabs">
        <div className={`page-tab${tab === "skills" ? " on" : ""}`} onClick={() => setTab("skills")}>skills</div>
        <div className={`page-tab${tab === "tools" ? " on" : ""}`} onClick={() => setTab("tools")}>tools</div>
      </div>
      {tab === "skills" ? <RegistryUnavailable kind="skill" /> : <RegistryUnavailable kind="tool" />}
    </div>
  );
}
