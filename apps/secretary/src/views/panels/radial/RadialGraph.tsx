import React, { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeMouseHandler, type Viewport } from "@xyflow/react";
import type { ProjectionReadModel } from "@carnegie/contracts";
import { buildRadialLayout, type RadialGraphNode } from "./radial-layout.js";
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
      label: node.label,
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
      ariaLabel: `${node.label} ${node.kind}${node.state === undefined ? "" : `, ${node.state}`}`,
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

function GraphCanvas({ layout, selectedNodeId, onSelect }: { layout: ReturnType<typeof buildRadialLayout>; selectedNodeId: string | undefined; onSelect: (nodeId: string) => void }) {
  const { zoomIn, zoomOut, fitView, getViewport, setViewport, setCenter } = useReactFlow();
  const [query, setQuery] = useState("");
  const nodes = useMemo(() => flowNodes(layout.nodes, selectedNodeId), [layout.nodes, selectedNodeId]);
  const edges = useMemo(() => flowEdges(layout.edges), [layout.edges]);
  const selected = nodes.find((node) => node.id === selectedNodeId);
  const matchingNode = nodes.find((node) => String(node.data.label).toLowerCase().includes(query.trim().toLowerCase()));
  const handleNodeClick: NodeMouseHandler = (_event, node) => onSelect(node.id);
  const panBy = (x: number, y: number) => {
    const viewport = getViewport();
    void setViewport(panViewport(viewport, x, y), { duration: 150 });
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && matchingNode !== undefined) {
      onSelect(matchingNode.id);
      void setCenter(matchingNode.position.x + 48, matchingNode.position.y + 28, { zoom: 1.1, duration: 200 });
    }
  };

  return (
    <>
      <div className="radial-toolbar" role="toolbar" aria-label="Radial graph controls">
        <label className="radial-search">
          <span>Find node</span>
          <input aria-label="Search graph nodes" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Search nodes" />
        </label>
        <button type="button" className="btn btn-sm" aria-label="Zoom in" onClick={() => void zoomIn()}><span aria-hidden="true">+</span> zoom</button>
        <button type="button" className="btn btn-sm" aria-label="Zoom out" onClick={() => void zoomOut()}><span aria-hidden="true">−</span> zoom</button>
        <button type="button" className="btn btn-sm" aria-label="Fit graph" onClick={() => void fitView({ duration: 200 })}>fit</button>
        <span className="radial-pan-controls" aria-label="Pan graph">
          <button type="button" className="btn btn-sm" aria-label="Pan up" onClick={() => panBy(0, 80)}>↑</button>
          <button type="button" className="btn btn-sm" aria-label="Pan down" onClick={() => panBy(0, -80)}>↓</button>
          <button type="button" className="btn btn-sm" aria-label="Pan left" onClick={() => panBy(80, 0)}>←</button>
          <button type="button" className="btn btn-sm" aria-label="Pan right" onClick={() => panBy(-80, 0)}>→</button>
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
      <div className="radial-accessible-nodes" aria-label="Radial graph nodes">
        {nodes.map((node) => (
          <button key={node.id} type="button" className="radial-node-link" data-radial-node-id={node.id} data-radial-node-version={node.data.version === undefined ? "" : String(node.data.version)} aria-pressed={node.selected === true} onClick={() => onSelect(node.id)}>
            {String(node.data.label)} <span>{String(node.data.kind)}{node.data.state === undefined ? "" : ` · ${String(node.data.state)}`}</span>
          </button>
        ))}
      </div>
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
        <button type="button" className="gitbar-back" onClick={onBack}><span aria-hidden="true">←</span> back</button>
        <span className="radial-title">organization floor</span>
        <span className="sub">durable projection · cursor {projection.eventCursor}</span>
        {selected !== undefined && <span className="radial-selection" role="status">selected: {selected.label} · {selected.state ?? selected.kind}</span>}
      </div>
      <ReactFlowProvider>
        <GraphCanvas layout={layout} selectedNodeId={selectedNodeId} onSelect={onSelectNode} />
      </ReactFlowProvider>
      <div className="floor-legend radial-legend" aria-label="Radial graph legend">
        <span><span className="legend-dot" style={{ background: "var(--terracotta)" }} /> Concertmaster</span>
        <span><span className="legend-dot" style={{ background: "var(--p-teal)" }} /> Department</span>
        <span><span className="legend-dot" style={{ background: "var(--olive)" }} /> Worker</span>
        <span><span className="legend-dot" style={{ background: "var(--ochre)" }} /> select a node for cross-links</span>
      </div>
    </div>
  );
}
