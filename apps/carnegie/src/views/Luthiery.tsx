import React, { useState } from "react";
import { EmptyState } from "../components/EmptyState.js";

function RegistryUnavailable({ kind }: { kind: "skill" | "tool" }) {
  return (
    <div className="page-body">
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="dash-head" style={{ padding: "14px 20px 0" }}><div className="dash-title">luthiery</div></div>
      <div className="dash-sub" style={{ padding: "0 20px" }}>tool &amp; skill workshop · durable registry unavailable</div>
      <div className="page-tabs">
        <div className={`page-tab${tab === "skills" ? " on" : ""}`} onClick={() => setTab("skills")}>skills</div>
        <div className={`page-tab${tab === "tools" ? " on" : ""}`} onClick={() => setTab("tools")}>tools</div>
      </div>
      {tab === "skills" ? <RegistryUnavailable kind="skill" /> : <RegistryUnavailable kind="tool" />}
    </div>
  );
}
