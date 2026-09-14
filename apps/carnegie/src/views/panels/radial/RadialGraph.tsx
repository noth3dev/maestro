import React, { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeMouseHandler, type Viewport } from "@xyflow/react";
import type { ProjectionReadModel } from "@maestro/contracts";
import { buildRadialLayout, type RadialGraphNode } from "./radial-layout.js";
import { LinearAlternative } from "./LinearAlternative.js";
import { useT } from "../../../i18n/index.js";
import "@xyflow/react/dist/style.css";

interface RadialNodeData extends Record<string, unknown> {
  label: string;
  kind: RadialGraphNode["kind"];
  state?: string;
  version?: number | null;
  goalId?: string;
  ownerId?: string | null;
}

export function panViewport(viewport: Viewport, x: number, y: number): Viewport {
  return { x: viewport.x + x, y: viewport.y + y, zoom: viewport.zoom };
}

export function goalSelectionId(node: RadialGraphNode): string | undefined {
  return node.kind === "goal" && node.goalId !== undefined ? node.goalId : undefined;
}

export interface RadialGraphProps {
  projection: ProjectionReadModel;
  selectedGoalId?: string;
  onSelectGoal?: (goalId: string) => void;
  onBack: () => void;
}

function stateClass(state: string | undefined): string {
  return state === undefined ? "" : ` radial-node-state-${state.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function flowNodes(nodes: readonly RadialGraphNode[], selectedNodeId: string | undefined): Node<RadialNodeData>[] {
  return nodes.map((node) => {
    const data: RadialNodeData = {
      label: node.state === undefined ? node.label : `${node.label} · ${node.state}`,
      kind: node.kind,
      ...(node.state === undefined ? {} : { state: node.state }),
      ...(node.version === undefined ? {} : { version: node.version }),
      ...(node.ownerId === undefined ? {} : { ownerId: node.ownerId }),
      ...(node.goalId === undefined ? {} : { goalId: node.goalId }),
    };
    return {
      id: node.id,
      type: "default" as const,
      className: `radial-node radial-node-${node.kind}${node.compressed === true ? " radial-node-compressed" : ""}${stateClass(node.state)}`,
      position: { x: node.x + 460, y: node.y + 330 },
      data,
      selected: node.id === selectedNodeId,
      hidden: node.collapsed === true,
      draggable: false,
      selectable: node.kind !== "concertmaster",
      ariaLabel: `${node.label} ${node.kind}${node.state === undefined ? "" : `, Status: ${node.state}`}`,
    };
  });
}

function flowEdges(edges: ReturnType<typeof buildRadialLayout>["edges"]): Edge[] {
  return edges.filter((edge) => !edge.hidden).map((edge) => ({
    id: edge.edgeId,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    type: "smoothstep",
    animated: edge.kind === "tracks",
    label: edge.kind,
    data: { sourceRevision: edge.sourceRevision, eventCursor: edge.eventCursor },
  }));
}

function GraphCanvas({ layout, selectedNodeId, onSelect, onBack }: { layout: ReturnType<typeof buildRadialLayout>; selectedNodeId: string | undefined; onSelect: (nodeId: string) => void; onBack: () => void }) {
  const t = useT();
  const { zoomIn, zoomOut, fitView, getViewport, setViewport, setCenter } = useReactFlow();
  const [query, setQuery] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const nodes = useMemo(() => flowNodes(layout.nodes, selectedNodeId), [layout.nodes, selectedNodeId]);
  const edges = useMemo(() => flowEdges(layout.edges), [layout.edges]);
  const selected = nodes.find((node) => node.id === selectedNodeId);
  const matchingNode = nodes.find((node) => String(node.data.label).toLowerCase().includes(query.trim().toLowerCase()));
  const motionOptions = { duration: reducedMotion ? 0 : 200 };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const handleNodeClick: NodeMouseHandler = (_event, node) => onSelect(node.id);
  const panBy = (x: number, y: number) => {
    const viewport = getViewport();
    void setViewport(panViewport(viewport, x, y), motionOptions);
  };
  const searchGraph = () => {
    if (matchingNode === undefined) return;
    onSelect(matchingNode.id);
    void setCenter(matchingNode.position.x + 48, matchingNode.position.y + 28, { zoom: 1.1, ...motionOptions });
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchGraph();
    }
  };
  const panDirection = (direction: "up" | "down" | "left" | "right") => {
    const offsets = { up: [0, 80], down: [0, -80], left: [80, 0], right: [-80, 0] } as const;
    const [x, y] = offsets[direction];
    panBy(x, y);
  };
  const operations = {
    query,
    onQueryChange: setQuery,
    onSearch: searchGraph,
    onZoomIn: () => void zoomIn(motionOptions),
    onZoomOut: () => void zoomOut(motionOptions),
    onFit: () => void fitView(motionOptions),
    onPan: panDirection,
    onBack,
  };

  return (
    <>
      <div className="radial-toolbar" role="toolbar" aria-label={t.radial.controls} data-reduced-motion="supported">
        <label className="radial-search">
          <span>{t.radial.searchLabel}</span>
          <input aria-label={t.radial.searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder={t.radial.searchPlaceholder} />
        </label>
        <button type="button" className="btn btn-sm" aria-label={t.radial.zoomIn} onClick={operations.onZoomIn}><span aria-hidden="true">+</span> {t.radial.zoomIn}</button>
        <button type="button" className="btn btn-sm" aria-label={t.radial.zoomOut} onClick={operations.onZoomOut}><span aria-hidden="true">−</span> {t.radial.zoomOut}</button>
        <button type="button" className="btn btn-sm" aria-label={t.radial.fit} onClick={operations.onFit}>{t.radial.fit}</button>
        <span className="radial-pan-controls" aria-label={t.radial.pan}>
          <button type="button" className="btn btn-sm" aria-label={t.radial.panUp} onClick={() => panDirection("up")}>↑</button>
          <button type="button" className="btn btn-sm" aria-label={t.radial.panDown} onClick={() => panDirection("down")}>↓</button>
          <button type="button" className="btn btn-sm" aria-label={t.radial.panLeft} onClick={() => panDirection("left")}>←</button>
          <button type="button" className="btn btn-sm" aria-label={t.radial.panRight} onClick={() => panDirection("right")}>→</button>
        </span>
        {layout.virtualized && <span className="radial-virtualized" role="status">large organization · virtualized</span>}
      </div>
      <div className="radial-flow" aria-label="Organization radial graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={handleNodeClick}
          fitView
          onlyRenderVisibleElements
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          nodesFocusable
          edgesFocusable
          proOptions={{ hideAttribution: true }}
          colorMode="light"
        />
      </div>
      {selected?.data.kind === "department_plan" && selected.data.ownerId !== null && selected.data.ownerId !== undefined && (
        <div className="radial-head-detail" role="status">Department Head: {selected.data.ownerId} · projection node {selected.id} · version {selected.data.version ?? "—"}</div>
      )}
      <LinearAlternative nodes={layout.nodes} selectedNodeId={selectedNodeId} onSelect={onSelect} operations={operations} />
    </>
  );
}

export function RadialGraph({ projection, selectedGoalId, onSelectGoal, onBack }: RadialGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const layout = useMemo(() => buildRadialLayout(projection, {
    ...(selectedGoalId === undefined ? {} : { selectedGoalId }),
    ...(selectedNodeId === undefined ? {} : { selectedNodeId }),
  }), [projection, selectedGoalId, selectedNodeId]);
  const selected = layout.nodes.find((node) => node.id === selectedNodeId);
  const t = useT();
  const onShellClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setSelectedNodeId(undefined);
  };
  const onSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = layout.nodes.find((entry) => entry.id === nodeId);
    const goalId = node === undefined ? undefined : goalSelectionId(node);
    if (goalId !== undefined && onSelectGoal !== undefined) onSelectGoal(goalId);
  };

  return (
    <div className="floor-wrap radial-graph-shell" onClick={onShellClick}>
      <div className="floor-head radial-graph-head">
        <button type="button" className="gitbar-back" onClick={onBack}><span aria-hidden="true">←</span> {t.radial.back}</button>
        <span className="radial-title">{t.radial.title}</span>
        <span className="sub">durable projection · cursor {projection.eventCursor}</span>
        {selected !== undefined && <span className="radial-selection" role="status">{t.radial.selected}: {selected.label} · {selected.state ?? selected.kind}</span>}
      </div>
      <ReactFlowProvider>
        <GraphCanvas layout={layout} selectedNodeId={selectedNodeId} onSelect={onSelectNode} onBack={onBack} />
      </ReactFlowProvider>
      <div className="floor-legend radial-legend" aria-label="Radial graph legend">
        <span><span className="legend-dot" style={{ background: "var(--terracotta)" }} /> <span aria-hidden="true">●</span> Concertmaster</span>
        <span><span className="legend-dot" style={{ background: "var(--p-teal)" }} /> <span aria-hidden="true">□</span> Department</span>
        <span><span className="legend-dot" style={{ background: "var(--olive)" }} /> <span aria-hidden="true">✓</span> Worker</span>
        <span><span className="legend-dot" style={{ background: "var(--ochre)" }} /> <span aria-hidden="true">↗</span> select a node for cross-links</span>
      </div>
    </div>
  );
}
