import { hierarchy } from "d3-hierarchy";
import type { ProjectionEdge, ProjectionNode, ProjectionReadModel } from "@maestro/contracts";

export interface RadialLayoutOptions {
  /** The focused Goal. When a project projection contains several Goals, others remain visible but compressed. */
  selectedGoalId?: string;
  selectedNodeId?: string;
  maxVisibleNodes?: number;
}

export interface RadialGraphNode {
  id: string;
  label: string;
  kind: ProjectionNode["kind"] | "concertmaster" | "sector" | "task_contract";
  synthetic: boolean;
  x: number;
  y: number;
  radius: number;
  angle: number;
  labelRotation: 0;
  sourceKey?: readonly string[];
  version?: number | null;
  state?: string;
  ownerId?: string | null;
  goalId?: string;
  sourceRevision?: string;
  eventCursor?: string;
  collapsed?: boolean;
  compressed?: boolean;
}

export interface RadialGraphEdge extends ProjectionEdge {
  hidden: boolean;
}

export interface RadialLayout {
  nodes: readonly RadialGraphNode[];
  edges: readonly RadialGraphEdge[];
  virtualized: boolean;
}

interface SectorTreeData {
  id: string;
  children?: SectorTreeData[];
}

const UI_NODE_PREFIX = "ui:radial:";
const sectorNodeId = (key: string) => `${UI_NODE_PREFIX}sector:${key}`;

const criticalStates = new Set(["blocked", "failed", "certifying", "pausing", "stopping", "recovering"]);
const nodeRadii: Record<RadialGraphNode["kind"], number> = {
  concertmaster: 0,
  sector: 220,
  goal: 96,
  task_contract: 64,
  council: 126,
  department_plan: 156,
  mission_bundle: 184,
  worker: 212,
  git_goal_branch: 244,
  git_department_branch: 260,
  git_worker_worktree: 276,
  git_commit: 292,
  capability_approval: 244,
  improvement_digest: 244,
};

function sectorFor(node: ProjectionNode): string {
  return node.sectorId ?? "unassigned";
}

function goalIdsFor(nodes: readonly ProjectionNode[]): string[] {
  return [...new Set(nodes.map((node) => node.goalId))].sort();
}

function hasMultipleGoals(nodes: readonly ProjectionNode[], selectedGoalId: string | undefined): boolean {
  return selectedGoalId !== undefined && goalIdsFor(nodes).length > 1;
}

function groupKey(node: ProjectionNode, multipleGoals: boolean): string {
  return multipleGoals ? `${node.goalId}:${sectorFor(node)}` : sectorFor(node);
}

function labelFor(node: ProjectionNode): string {
  if (node.kind === "department_plan" && node.ownerId !== null) return `${sectorFor(node)} · Head ${node.ownerId}`;
  return sectorFor(node) === "unassigned" ? node.kind.replaceAll("_", " ") : sectorFor(node);
}

function point(radius: number, angle: number): { x: number; y: number } {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function isCollapsed(node: ProjectionNode, options: RadialLayoutOptions, multipleGoals: boolean, sleepingDepartmentIds: ReadonlySet<string>): boolean {
  if (criticalStates.has(node.state)) return false;
  if (multipleGoals && node.goalId !== options.selectedGoalId && node.kind !== "goal" && node.kind !== "department_plan") return true;
  if (node.kind !== "worker") return false;
  const selectedSector = options.selectedNodeId?.startsWith(`${UI_NODE_PREFIX}sector:`) ? options.selectedNodeId.slice(`${UI_NODE_PREFIX}sector:`.length) : undefined;
  const expanded = options.selectedNodeId === node.nodeId || options.selectedNodeId === node.parentNodeId || selectedSector === groupKey(node, multipleGoals);
  if (expanded) return false;
  if (node.parentNodeId !== null && sleepingDepartmentIds.has(node.parentNodeId)) return true;
  return !expanded;
}

export function buildRadialLayout(projection: ProjectionReadModel, options: RadialLayoutOptions = {}): RadialLayout {
  const allNodes = projection.nodes.filter((node) => !node.removed);
  const multipleGoals = hasMultipleGoals(allNodes, options.selectedGoalId);
  const scoped = allNodes.filter((node) => options.selectedGoalId === undefined || multipleGoals || node.goalId === options.selectedGoalId);
  const sleepingDepartmentIds = new Set(scoped.filter((node) => node.kind === "department_plan" && node.state === "sleeping").map((node) => node.nodeId));
  const visible = scoped;
  // React Flow performs viewport culling; keep the full projection in the source list so
  // search and critical blockers remain reachable even when the graph is large.
  const virtualized = visible.length > Math.max(1, options.maxVisibleNodes ?? 48);
  const sectorIds = [...new Set(visible.filter((node) => node.kind !== "goal").map((node) => groupKey(node, multipleGoals)))].sort();
  const sectorTree = hierarchy<SectorTreeData>({ id: "root", children: sectorIds.map((id) => ({ id })) });
  const sectors = sectorTree.children ?? [];
  const sectorAngles = new Map(sectors.map((sector, index) => [sector.data.id, -Math.PI / 2 + (index / Math.max(1, sectors.length)) * Math.PI * 2]));
  const goals = visible.filter((node) => node.kind === "goal");
  const goalIds = goalIdsFor(goals);
  const goalAngles = new Map(goalIds.map((id, index) => [id, multipleGoals ? -Math.PI / 2 + (index / Math.max(1, goalIds.length)) * Math.PI * 2 : -Math.PI / 2]));
  const result: RadialGraphNode[] = [{ id: `${UI_NODE_PREFIX}concertmaster`, label: "Concertmaster", kind: "concertmaster", synthetic: true, x: 0, y: 0, radius: 0, angle: 0, labelRotation: 0 }];

  for (const goal of goals) {
    const goalAngle = goalAngles.get(goal.goalId) ?? -Math.PI / 2;
    const contractRadius = !multipleGoals || goal.goalId === options.selectedGoalId ? nodeRadii.task_contract : 78;
    const contractPosition = point(contractRadius, goalAngle);
    // Task Contract is a decorative inner halo until the projection contract exposes a
    // durable contract node. It is intentionally synthetic and never an actionable source node.
    result.push({ id: `${UI_NODE_PREFIX}task-contract:${goal.goalId}`, label: goal.goalId === options.selectedGoalId || !multipleGoals ? "Task Contract" : `Contract · ${goal.goalId.slice(0, 8)}`, kind: "task_contract", synthetic: true, ...contractPosition, radius: contractRadius, angle: goalAngle, labelRotation: 0, state: goal.state, compressed: multipleGoals && goal.goalId !== options.selectedGoalId });
  }

  for (const goal of goals) {
    const angle = goalAngles.get(goal.goalId) ?? -Math.PI / 2;
    const radius = !multipleGoals || goal.goalId === options.selectedGoalId ? nodeRadii.goal : 120;
    const position = point(radius, angle);
    result.push({ id: goal.nodeId, label: goal.goalId === options.selectedGoalId || !multipleGoals ? "Goal" : `Goal · ${goal.goalId.slice(0, 8)}`, kind: goal.kind, synthetic: false, ...position, radius, angle, labelRotation: 0, sourceKey: goal.sourceKey, version: goal.version, state: goal.state, ownerId: goal.ownerId, goalId: goal.goalId, sourceRevision: goal.sourceRevision, eventCursor: goal.eventCursor, compressed: multipleGoals && goal.goalId !== options.selectedGoalId });
  }

  for (const sector of sectors) {
    const angle = sectorAngles.get(sector.data.id) ?? 0;
    const sectorPosition = point(nodeRadii.sector, angle);
    const sectorNode = visible.find((node) => node.kind !== "goal" && groupKey(node, multipleGoals) === sector.data.id);
    result.push({ id: sectorNodeId(sector.data.id), label: sectorNode === undefined ? sector.data.id : sectorFor(sectorNode), kind: "sector", synthetic: true, ...sectorPosition, radius: nodeRadii.sector, angle, labelRotation: 0, state: "participating" });
    const sectorNodes = visible.filter((node) => node.kind !== "goal" && groupKey(node, multipleGoals) === sector.data.id);
    sectorNodes.forEach((node, nodeIndex) => {
      const spread = (nodeIndex - (sectorNodes.length - 1) / 2) * 0.08;
      const nodeAngle = angle + spread;
      const radius = nodeRadii[node.kind];
      const position = point(radius, nodeAngle);
      result.push({ id: node.nodeId, label: multipleGoals && node.goalId !== options.selectedGoalId && node.kind === "department_plan" ? sectorFor(node) : labelFor(node), kind: node.kind, synthetic: false, ...position, radius, angle: nodeAngle, labelRotation: 0, sourceKey: node.sourceKey, version: node.version, state: node.state, ownerId: node.ownerId, goalId: node.goalId, sourceRevision: node.sourceRevision, eventCursor: node.eventCursor, collapsed: isCollapsed(node, options, multipleGoals, sleepingDepartmentIds), compressed: multipleGoals && node.goalId !== options.selectedGoalId });
    });
  }

  const edges = projection.edges.filter((edge) => !edge.removed && (options.selectedGoalId === undefined || multipleGoals || edge.goalId === null || edge.goalId === options.selectedGoalId));
  return { nodes: result, edges: filterRadialEdges(edges, options.selectedNodeId), virtualized };
}

export function filterRadialEdges(edges: readonly ProjectionEdge[], selectedNodeId: string | undefined): RadialGraphEdge[] {
  return edges.map((edge) => ({ ...edge, hidden: edge.kind !== "contains" && selectedNodeId !== edge.fromNodeId && selectedNodeId !== edge.toNodeId }));
}
