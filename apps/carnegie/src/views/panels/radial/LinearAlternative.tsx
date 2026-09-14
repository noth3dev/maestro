import React, { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../../i18n/index.js";
import type { RadialGraphNode } from "./radial-layout.js";

export interface LinearAlternativeOperations {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onPan: (direction: "up" | "down" | "left" | "right") => void;
  onBack: () => void;
}

export interface LinearAlternativeProps {
  nodes: readonly RadialGraphNode[];
  selectedNodeId: string | undefined;
  onSelect: (nodeId: string) => void;
  operations: LinearAlternativeOperations;
}

function statusIcon(state: string | undefined): string {
  if (state === undefined) return "○";
  if (["blocked", "failed", "pausing", "stopping"].includes(state.toLowerCase())) return "!";
  if (["active", "running", "approved", "success", "participating"].includes(state.toLowerCase())) return "✓";
  return "•";
}

function nodeStatus(node: RadialGraphNode, statusLabel: string): string {
  return `${statusLabel}: ${node.state ?? "not reported"}`;
}

export function LinearAlternative({ nodes, selectedNodeId, onSelect, operations }: LinearAlternativeProps) {
  const t = useT();
  const [detailsNodeId, setDetailsNodeId] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const detailsNode = detailsNodeId === undefined ? undefined : nodes.find((node) => node.id === detailsNodeId);

  useEffect(() => {
    if (detailsNode === undefined) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    (dialog.querySelector<HTMLElement>("button") ?? dialog).focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDetailsNodeId(undefined);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [detailsNode]);

  useEffect(() => {
    if (detailsNodeId !== undefined || returnFocusRef.current === null) return;
    returnFocusRef.current.focus();
    returnFocusRef.current = null;
  }, [detailsNodeId]);

  const openDetails = (node: RadialGraphNode, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setDetailsNodeId(node.id);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      operations.onSearch();
    }
  };

  return (
    <section className="radial-linear-alternative" aria-label={t.radial.linearAlternative} data-reduced-motion="supported">
      <div className="radial-linear-head">
        <div>
          <h2>{t.radial.linearAlternative}</h2>
          <p>{t.radial.linearHint}</p>
        </div>
        <button type="button" className="btn btn-sm" data-linear-operation="back" onClick={operations.onBack}>{t.radial.backToFloor}</button>
      </div>
      <div className="radial-linear-controls" role="toolbar" aria-label={t.radial.controls}>
        <label className="radial-search">
          <span>{t.radial.searchLabel}</span>
          <input aria-label={t.radial.searchLabel} placeholder={t.radial.searchPlaceholder} value={operations.query} onChange={(event) => operations.onQueryChange(event.target.value)} onKeyDown={onSearchKeyDown} />
        </label>
        <button type="button" className="btn btn-sm" data-linear-operation="search" onClick={operations.onSearch}>{t.radial.find}</button>
        <button type="button" className="btn btn-sm" data-linear-operation="zoom-in" onClick={operations.onZoomIn}>{t.radial.zoomIn}</button>
        <button type="button" className="btn btn-sm" data-linear-operation="zoom-out" onClick={operations.onZoomOut}>{t.radial.zoomOut}</button>
        <button type="button" className="btn btn-sm" data-linear-operation="fit" onClick={operations.onFit}>{t.radial.fit}</button>
        <span className="radial-pan-controls" aria-label={t.radial.pan}>
          {(["up", "down", "left", "right"] as const).map((direction) => {
            const label = { up: t.radial.panUp, down: t.radial.panDown, left: t.radial.panLeft, right: t.radial.panRight }[direction];
            return <button key={direction} type="button" className="btn btn-sm" data-linear-operation={`pan-${direction}`} aria-label={label} onClick={() => operations.onPan(direction)}>{direction === "up" ? "↑" : direction === "down" ? "↓" : direction === "left" ? "←" : "→"}</button>;
          })}
        </span>
      </div>
      <div className="radial-linear-status" role="status" aria-live="polite">{selectedNodeId === undefined ? t.radial.statusReady : `${t.radial.selected}: ${nodes.find((node) => node.id === selectedNodeId)?.label ?? selectedNodeId}`}</div>
      <ul className="radial-linear-tree" role="tree" aria-label={t.radial.linearAlternative}>
        {nodes.map((node) => {
          const selected = node.id === selectedNodeId;
          const status = nodeStatus(node, t.radial.nodeStatus);
          return <li key={node.id} role="treeitem" aria-level={1} aria-expanded={node.collapsed === undefined ? undefined : !node.collapsed} aria-selected={selected}>
            <button type="button" className="radial-linear-node" data-linear-operation="select-node" data-radial-node-id={node.id} data-radial-node-version={node.version === undefined ? "" : String(node.version)} aria-pressed={selected} onClick={() => onSelect(node.id)}>
              <span className="status-marker" aria-hidden="true">{statusIcon(node.state)}</span>
              <span className="radial-linear-node-label">{node.label}</span>
              <span className="radial-linear-node-meta">{node.kind} · {status}</span>
              <span className="sr-only">{node.synthetic ? "synthetic" : "projection"}{node.compressed ? " · compressed" : ""}{node.collapsed ? " · collapsed" : ""}</span>
            </button>
            <button type="button" className="btn btn-sm radial-linear-details" onClick={(event) => openDetails(node, event.currentTarget)}>{t.radial.nodeDetails}</button>
          </li>;
        })}
      </ul>
      <div className="radial-linear-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="radial-node-dialog-title" tabIndex={-1} hidden={detailsNode === undefined}>
        {detailsNode !== undefined && <>
          <h2 id="radial-node-dialog-title">{t.radial.nodeDetails}: {detailsNode.label}</h2>
          <p>{detailsNode.kind} · {nodeStatus(detailsNode, t.radial.nodeStatus)}</p>
          {detailsNode.version !== undefined && <p>version {detailsNode.version ?? "—"}</p>}
          <button type="button" className="btn btn-sm" onClick={() => setDetailsNodeId(undefined)}>{t.radial.close}</button>
        </>}
      </div>
    </section>
  );
}
