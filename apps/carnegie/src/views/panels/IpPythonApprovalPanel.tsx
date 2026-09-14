import React, { useState } from "react";
import type { FullAccessMode } from "@maestro/contracts";
import type { IpPythonApprovalState, NodeActionsApi } from "../../lib/node-actions.js";
import { runNodeAction } from "../../lib/node-actions.js";
import type { ProjectionNode } from "@maestro/contracts";

export interface IpPythonApprovalPanelProps {
  readonly state: IpPythonApprovalState;
  readonly node: ProjectionNode;
  readonly api: NodeActionsApi;
  readonly onStop?: () => void;
  readonly commandId?: () => string;
}

/**
 * Displays the existing capability-approval facts. It does not decide authority locally.
 * In particular, skip-intermediate mode still discloses that user approval is required.
 */
export function IpPythonApprovalPanel({ state, node, api, onStop, commandId = () => globalThis.crypto.randomUUID() }: IpPythonApprovalPanelProps) {
  const [mode, setMode] = useState<FullAccessMode>(state.fullAccessMode);
  const [error, setError] = useState<string | undefined>();
  const facts = { ...state, userTierRequired: true as const };
  const selectMode = async (next: FullAccessMode) => {
    setError(undefined);
    setMode(next);
    try {
      await runNodeAction(api, { kind: "full-access", node, mode: next, sessionId: node.goalId }, commandId());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not select the IPython access mode");
    }
  };
  return (
    <section className="office-panel ipython-approval-panel" aria-labelledby="ipython-approval-title">
      <div className="office-panel-heading"><h2 id="ipython-approval-title">IPython approval and access</h2>{onStop !== undefined && <button type="button" className="btn btn-sm" onClick={onStop}>Stop IPython</button>}</div>
      <dl className="ipython-approval-facts">
        <div><dt>Session scope</dt><dd>{facts.sessionScope}</dd></div>
        <div><dt>Temporary tools</dt><dd>{facts.temporaryTools.length === 0 ? "None" : facts.temporaryTools.join(", ")}</dd></div>
        <div><dt>Active approval tier</dt><dd>{facts.activeTier}</dd></div>
        <div><dt>Pending decision</dt><dd>{facts.pendingDecision ?? "None"}</dd></div>
        <div><dt>User approval request</dt><dd>{facts.userApprovalRequest ?? "None"}</dd></div>
        <div><dt>Repetition budget</dt><dd>{facts.repetitionBudget}</dd></div>
        <div><dt>Full-access mode</dt><dd>{mode}</dd></div>
        <div><dt>User tier</dt><dd>Required for every full-access mode</dd></div>
        <div><dt>External capabilities</dt><dd>{facts.externalCapabilities.length === 0 ? "None" : facts.externalCapabilities.join(", ")}</dd></div>
      </dl>
      <div role="group" aria-label="IPython full-access mode">
        <button type="button" className="btn btn-sm" aria-pressed={mode === "retain_intermediate_approvals"} onClick={() => void selectMode("retain_intermediate_approvals")}>Retain intermediate approvals</button>
        <button type="button" className="btn btn-sm" aria-pressed={mode === "skip_intermediate_approvals"} onClick={() => void selectMode("skip_intermediate_approvals")}>Skip intermediate approvals</button>
      </div>
      {error !== undefined && <p role="alert" className="alert alert-warning">{error}</p>}
    </section>
  );
}
