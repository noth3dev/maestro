import React, { useState } from "react";
import type { ProjectionNode } from "@maestro/contracts";
import { buildNodeActions, runNodeAction, type NodeActionsApi, type NodeAction, type NodeActionActor, type CriticalCommandInput, type CriticalConfirmation } from "../../../lib/node-actions.js";

export interface NodeActionControlsProps {
  readonly node: ProjectionNode;
  readonly api: NodeActionsApi;
  /** Optional server-derived authority context; omitted means authority is left to the server. */
  readonly actor?: NodeActionActor;
  /** Critical controls are omitted unless this exact server-derived disclosure is supplied. */
  readonly critical?: CriticalConfirmation;
  readonly criticalInput?: CriticalCommandInput;
  readonly criticalCommand?: "requestCriticalAction" | "approveAndRunCriticalAction";
}


function propsContext(actor: NodeActionActor | undefined) {
  return actor === undefined ? {} : { actor };
}

/** Selected-node lifecycle controls use the same typed bridge as the CLI. */
export function NodeActionControls({ node, api, actor, critical, criticalInput, criticalCommand }: NodeActionControlsProps) {
  const [pending, setPending] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const actions = buildNodeActions(node, { ...propsContext(actor), ...(critical === undefined ? {} : { critical }), ...(criticalInput === undefined ? {} : { criticalInput }), ...(criticalCommand === undefined ? {} : { criticalCommand }) });
  if (actions.length === 0) return null;

  const run = async (action: NodeAction) => {
    if (action.kind === "unauthorized" || action.enabled === false) return;
    setPending(action.command);
    setError(undefined);
    try {
      if (action.kind === "critical") {
        await runNodeAction(api, { kind: "critical", command: action.command, node, critical: action.confirmation, ...(action.criticalInput === undefined ? {} : { criticalInput: action.criticalInput }) }, globalThis.crypto.randomUUID());
      } else {
        await runNodeAction(api, { kind: "command", command: action.command, node }, globalThis.crypto.randomUUID());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Control Plane rejected this action");
    } finally {
      setPending(undefined);
    }
  };

  return (
    <section className="radial-node-actions" aria-labelledby="radial-node-actions-title">
      <h3 id="radial-node-actions-title">Selected node actions</h3>
      <div role="group" aria-label={`Actions for ${node.nodeId}`}>
        {actions.map((action) => action.kind === "unauthorized" ? (
          <span key={action.command} className="radial-action-disabled" title={action.reason}>{action.label}: {action.reason} ({action.decisionPath})</span>
        ) : (
          <button key={action.command} type="button" className="btn btn-sm" disabled={pending !== undefined} onClick={() => void run(action)}>{pending === action.command ? "Submitting…" : action.label}</button>
        ))}
      </div>
      {actions.filter((action): action is Extract<NodeAction, { kind: "critical" }> => action.kind === "critical").map((action) => (
        <dl key={`${action.command}-confirmation`} className="radial-critical-confirmation" aria-label="Critical action confirmation">
          <div><dt>Action</dt><dd>{action.confirmation.action}</dd></div>
          <div><dt>Target</dt><dd>{action.confirmation.target}</dd></div>
          <div><dt>Goal</dt><dd>{action.confirmation.goalId}</dd></div>
          <div><dt>Expiry</dt><dd>{action.confirmation.expiresAt}</dd></div>
          <div><dt>Expected effect</dt><dd>{action.confirmation.expectedEffect}</dd></div>
          <div><dt>Rollback feasibility</dt><dd>{action.confirmation.rollbackFeasibility}</dd></div>
        </dl>
      ))}
      {critical !== undefined && criticalInput === undefined && <p className="radial-action-disabled" role="status">Critical action unavailable until the exact policy version and budget effect are available.</p>}
      {error !== undefined && <p role="alert" className="alert alert-warning">{error}</p>}
    </section>
  );
}
