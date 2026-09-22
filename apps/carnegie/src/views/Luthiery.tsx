import React, { useState } from "react";
import { EmptyState } from "../components/EmptyState.js";

type RegistryKind = "skill" | "tool";

function RegistryUnavailable({ kind }: { kind: RegistryKind }) {
  return (
    <div className="page-body workspace-view-body" data-capability-status="backend-blocked">
      <div className="capability-status-row">
        <span className="badge badge-rust">backend-blocked</span>
        <span className="form-hint">No durable {kind} registry is available.</span>
      </div>
      <EmptyState
        title={`No durable ${kind} registry is available`}
        hint={`The control plane does not durably track ${kind} definitions, tags, certification state, or usage counts yet.`}
      />
      <section className="capability-dependency" aria-labelledby={`luthiery-${kind}-contract`}>
        <h2 id={`luthiery-${kind}-contract`}>Required backend contract</h2>
        <p>
          This view is read-only until the control plane owns these records. No local registry is created in Carnegie.
        </p>
        <ul>
          <li><code>listSkills</code>/<code>getSkill</code> and <code>listTools</code>/<code>getTool</code> durable reads</li>
          <li>certification and rejection state, content hashes, and tags</li>
          <li>durable usage and reuse reads scoped to the connected project</li>
          <li>authority-checked mutations with audit and evidence records</li>
        </ul>
        <div className="capability-actions">
          <button type="button" className="btn btn-sm" disabled>
            create {kind} (backend blocked)
          </button>
          <button type="button" className="btn btn-sm" disabled>
            certify {kind} (backend blocked)
          </button>
        </div>
        <h3>re-entry condition</h3>
        <p>
          Re-enter when the Phase 9 Luthiery contract is implemented in the control plane, typed API client, and Electron bridge,
          with durable certification and usage evidence. Until then this capability remains backend-blocked.
        </p>
      </section>
    </div>
  );
}

export function Luthiery({ initialTab = "skills" }: { initialTab?: "skills" | "tools" } = {}) {
  const [tab, setTab] = useState<"skills" | "tools">(initialTab);

  return (
    <div className="workspace-view">
      <header className="workspace-view-head">
        <div className="dash-kicker">workshop · Phase 9</div>
        <h1 className="dash-title">luthiery</h1>
        <p className="dash-sub">Dynamic tool and skill workshop. The durable registry is a future capability.</p>
      </header>
      <div className="page-tabs" role="tablist" aria-label="Luthiery registry type">
        <button type="button" role="tab" aria-selected={tab === "skills"} className={`page-tab${tab === "skills" ? " on" : ""}`} onClick={() => setTab("skills")}>skills</button>
        <button type="button" role="tab" aria-selected={tab === "tools"} className={`page-tab${tab === "tools" ? " on" : ""}`} onClick={() => setTab("tools")}>tools</button>
      </div>
      {tab === "skills" ? <RegistryUnavailable kind="skill" /> : <RegistryUnavailable kind="tool" />}
    </div>
  );
}
