import type { OrganizationReadModel } from "@maestro/api-client";
import type { ProjectionNode, ProjectionReadModel } from "@maestro/contracts";
import { panelLine, type PanelState } from "./common.js";

export interface ProjectionPanelValue {
  readonly projection: ProjectionReadModel;
  readonly organization?: OrganizationReadModel;
  departmentId?: string;
  groupId?: string;
  headId?: string;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function activeNodes(projection: ProjectionReadModel): ProjectionNode[] {
  return projection.nodes.filter((node) => !node.removed);
}

function departmentId(node: ProjectionNode): string {
  return node.sectorId ?? node.sourceKey.at(-1) ?? node.nodeId;
}

function nodeIdentity(node: ProjectionNode): string {
  return node.nodeId;
}

function childrenOf(projection: ProjectionReadModel): Map<string, string[]> {
  const children = new Map<string, string[]>();
  const add = (parent: string, child: string): void => {
    const values = children.get(parent) ?? [];
    if (!values.includes(child)) values.push(child);
    children.set(parent, values);
  };
  const nodeIds = new Set(activeNodes(projection).map((node) => node.nodeId));
  for (const edge of projection.edges) {
    if (!edge.removed && nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId) && edge.kind !== "references") add(edge.fromNodeId, edge.toNodeId);
  }
  // A valid projection normally has contains edges. Keeping the durable parent
  // relation as a fallback makes read-side rendering honest during a partial
  // event refresh without inventing an organizational relationship.
  for (const node of projection.nodes) {
    if (!node.removed && node.parentNodeId !== null && nodeIds.has(node.parentNodeId)) add(node.parentNodeId, node.nodeId);
  }
  return children;
}

function reachableWorkers(projection: ProjectionReadModel, departmentPlans: readonly ProjectionNode[]): ProjectionNode[] {
  const nodes = activeNodes(projection);
  const children = childrenOf(projection);
  const reachable = new Set<string>();
  for (const plan of departmentPlans) {
    const queue = [...(children.get(plan.nodeId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      queue.push(...(children.get(id) ?? []));
    }
  }
  const scoped = nodes.filter((node) => node.kind === "worker" && reachable.has(node.nodeId));
  return scoped.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function organizationDepartment(value: ProjectionPanelValue, id: string): OrganizationReadModel["departments"][number] | undefined {
  return value.organization?.departments.find((department) => department.departmentId === id);
}

function groupFor(value: ProjectionPanelValue, id: string): OrganizationReadModel["groups"][number] | undefined {
  const department = organizationDepartment(value, id);
  return department === undefined ? undefined : value.organization?.groups.find((group) => group.groupId === department.groupId);
}

function departmentPlans(value: ProjectionPanelValue): ProjectionNode[] {
  return activeNodes(value.projection).filter((node) => node.kind === "department_plan");
}

function renderRoot(value: ProjectionPanelValue, width: number): string[] {
  const plans = departmentPlans(value);
  const ids = [...new Set(plans.map(departmentId))].sort();
  if (ids.length === 0) return ["Organization projection", "No Departments are present in the projection."];
  const lines = ["Organization projection", `cursor ${value.projection.eventCursor}`, `Departments (${ids.length})`];
  for (const id of ids) {
    const scopedPlans = plans.filter((plan) => departmentId(plan) === id);
    const groups = new Set(scopedPlans.map(() => organizationDepartment(value, id)?.groupId).filter((entry): entry is string => entry !== undefined));
    const heads = new Set(scopedPlans.map((plan) => plan.ownerId).filter((entry): entry is string => entry !== null));
    const workers = reachableWorkers(value.projection, scopedPlans);
    const displayName = organizationDepartment(value, id)?.displayName ?? id;
    lines.push(panelLine(`• ${displayName} [${id}] · ${plural(groups.size, "Group")} · ${plural(heads.size, "Head")} · ${plural(workers.length, "Worker")}`, width));
    lines.push(panelLine(`  → /projection read --department-id=${id}`, width));
  }
  return lines;
}

function renderDepartment(value: ProjectionPanelValue, width: number): string[] {
  const id = value.departmentId!;
  const plans = departmentPlans(value).filter((plan) => departmentId(plan) === id);
  if (plans.length === 0) return ["Organization projection", `Department ${id} is not present in the projection.`];
  const group = groupFor(value, id);
  const workers = reachableWorkers(value.projection, plans);
  const heads = new Set(plans.map((plan) => plan.ownerId).filter((entry): entry is string => entry !== null));
  const lines = [`Department ${organizationDepartment(value, id)?.displayName ?? id} [${id}]`, `Groups (${group === undefined ? 0 : 1})`];
  if (group === undefined) lines.push("No Group identity is available for this Department.");
  else {
    lines.push(panelLine(`• ${group.displayName} [${group.groupId}] · ${plural(heads.size, "Head")} · ${plural(workers.length, "Worker")}`, width));
    lines.push(panelLine(`  → /projection read --department-id=${id} --group-id=${group.groupId}`, width));
  }
  return lines;
}

function renderGroup(value: ProjectionPanelValue, width: number): string[] {
  const department = value.departmentId!;
  const group = groupFor(value, department);
  const plans = departmentPlans(value).filter((plan) => departmentId(plan) === department);
  if (group === undefined || group.groupId !== value.groupId || plans.length === 0) return ["Organization projection", `Group ${value.groupId ?? ""} is not present for this Department.`];
  const heads = [...new Set(plans.map((plan) => plan.ownerId).filter((entry): entry is string => entry !== null))].sort();
  const lines = [`Group ${group.displayName} [${group.groupId}]`, `Heads (${heads.length})`];
  for (const head of heads) {
    const workers = reachableWorkers(value.projection, plans.filter((plan) => plan.ownerId === head));
    lines.push(panelLine(`• ${head} · ${plural(workers.length, "Worker")}`, width));
    lines.push(panelLine(`  → /projection read --department-id=${department} --group-id=${group.groupId} --head-id=${head}`, width));
  }
  if (heads.length === 0) lines.push("No Department Head is present in the projection.");
  return lines;
}

function renderHead(value: ProjectionPanelValue, width: number): string[] {
  const department = value.departmentId!;
  const actualGroup = groupFor(value, department);
  if (value.groupId !== undefined && (actualGroup === undefined || actualGroup.groupId !== value.groupId)) {
    return ["Organization projection", `Group ${value.groupId} is not present for this Department.`];
  }
  const plans = departmentPlans(value).filter((plan) => departmentId(plan) === department && plan.ownerId === value.headId);
  if (plans.length === 0) return ["Organization projection", `Head ${value.headId ?? ""} is not present for this Department.`];
  const workers = reachableWorkers(value.projection, plans);
  const lines = [`Head ${value.headId}`, `Workers (${workers.length})`];
  if (workers.length === 0) lines.push("No Workers are present under this Head.");
  for (const worker of workers) lines.push(panelLine(`• ${nodeIdentity(worker)} · ${worker.state} · source ${worker.sourceKey.join("/")}`, width));
  return lines;
}

export function renderProjectionPanel(state: PanelState<ProjectionPanelValue>, width: number): string[] {
  if (state.kind === "loading") return ["Organization projection", "Loading projection…"];
  if (state.kind === "error") return ["Organization projection", panelLine(`Unable to read projection: ${state.message}`, width)];
  if (state.kind === "empty") return ["Organization projection", "No Departments are present in the projection."];
  if (state.value.headId !== undefined) return renderHead(state.value, width);
  if (state.value.groupId !== undefined) return renderGroup(state.value, width);
  if (state.value.departmentId !== undefined) return renderDepartment(state.value, width);
  return renderRoot(state.value, width);
}
