import React, { useState } from "react";
import type { ProjectionNode } from "@maestro/contracts";
import { buildNodeActions, runNodeAction, type NodeActionsApi, type NodeAction, type NodeActionActor } from "../../../lib/node-actions.js";

export interface NodeActionControlsProps {
  readonly node: ProjectionNode;
  readonly api: NodeActionsApi;
  /** Optional server-derived authority context; omitted means authority is left to the server. */
  readonly actor?: NodeActionActor;
}


function propsContext(actor: NodeActionActor | undefined) {
  return actor === undefined ? {} : { actor };
}

/** Selected-node lifecycle controls use the same typed bridge as the CLI. */
export function NodeActionControls({ node, api, actor }: NodeActionControlsProps) {
  const [pending, setPending] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const actions = buildNodeActions(node, propsContext(actor));
  if (actions.length === 0) return null;

  const run = async (action: NodeAction) => {
    if (action.kind !== "command" || action.enabled === false) return;
    setPending(action.command);
    setError(undefined);
    try {
      await runNodeAction(api, { kind: "command", command: action.command, node }, globalThis.crypto.randomUUID());
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
      {error !== undefined && <p role="alert" className="alert alert-warning">{error}</p>}
    </section>
  );
}
