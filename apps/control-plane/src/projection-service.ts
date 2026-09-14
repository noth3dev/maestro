import {
  ProjectionEdgeSchema,
  ProjectionEventSchema,
  ProjectionNodeSchema,
  ProjectionReadModelSchema,
  ProjectionQuerySchema,
  type ProjectionEdge,
  type ProjectionEvent,
  type ProjectionNode,
  type ProjectionReadModel,
  type ProjectionQuery,
} from "@carnegie/contracts";
import type { Pool, QueryResultRow } from "pg";

type ProjectionQueryable = Pick<Pool, "query">;

interface ProjectionRow extends QueryResultRow {
  node_id: string;
  kind: ProjectionNode["kind"];
  project_id: string;
  goal_id: string;
  parent_node_id: string | null;
  sector_id: string | null;
  state: string;
  version: string | null;
  owner_id: string | null;
  cross_links: string[];
  source_revision: string;
  event_cursor: string;
  removed: boolean;
  source_key: string[];
}

export interface ProjectionService {
  read(query: ProjectionQuery, previous?: ProjectionReadModel): Promise<ProjectionReadModel>;
  compose(query: ProjectionQuery, previous?: ProjectionReadModel): Promise<ProjectionReadModel>;
}

export class ProjectionConsistencyError extends Error {}

/** Empty state used by event replay tests and by callers that incrementally apply durable events. */
export function emptyProjection(): ProjectionReadModel {
  const projection: ProjectionReadModel = { nodes: [], edges: [], eventCursor: "0" };
  appliedEvents.set(projection, new Set());
  return projection;
}

const appliedEvents = new WeakMap<object, Set<string>>();

function compareCursor(left: string, right: string): string {
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return left > right ? left : right;
}

function edgesFor(nodes: readonly ProjectionNode[]): ProjectionEdge[] {
  const edges: ProjectionEdge[] = [];
  const nodeById = new Set(nodes.map((node) => node.nodeId));
  for (const node of nodes) {
    if (!node.removed && node.parentNodeId !== null && nodeById.has(node.parentNodeId)) {
      edges.push(ProjectionEdgeSchema.parse({
        edgeId: `${node.nodeId}:contains:${node.parentNodeId}`,
        kind: "contains",
        fromNodeId: node.parentNodeId,
        toNodeId: node.nodeId,
        projectId: node.projectId,
        goalId: node.goalId,
        sourceRevision: node.sourceRevision,
        eventCursor: node.eventCursor,
        removed: false,
      }));
    }
    for (const target of node.crossLinks) {
      if (target === node.nodeId || !nodeById.has(target) || node.removed) continue;
      edges.push(ProjectionEdgeSchema.parse({
        edgeId: `${node.nodeId}:references:${target}`,
        kind: "references",
        fromNodeId: node.nodeId,
        toNodeId: target,
        projectId: node.projectId,
        goalId: node.goalId,
        sourceRevision: node.sourceRevision,
        eventCursor: node.eventCursor,
        removed: false,
      }));
    }
  }
  return edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
}

/** Apply an event without mutating the previous read model. Event IDs are the idempotency boundary. */
export function applyProjectionEvents(previous: ProjectionReadModel, events: readonly ProjectionEvent[]): ProjectionReadModel {
  const seen = appliedEvents.get(previous) ?? new Set<string>();
  const nodes = new Map(previous.nodes.map((node) => [node.nodeId, node]));
  let eventCursor = previous.eventCursor;
  const nextSeen = new Set(seen);
  for (const candidate of events) {
    const event = ProjectionEventSchema.parse(candidate);
    if (nextSeen.has(event.eventId)) continue;
    nextSeen.add(event.eventId);
    eventCursor = compareCursor(eventCursor, event.cursor);
    if (event.kind === "upsert") {
      nodes.set(event.node.nodeId, event.node);
    } else {
      const current = nodes.get(event.nodeId);
      if (current !== undefined) nodes.set(event.nodeId, { ...current, removed: true, eventCursor: event.cursor });
    }
  }
  const result: ProjectionReadModel = {
    nodes: [...nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    edges: edgesFor([...nodes.values()]),
    eventCursor,
  };
  appliedEvents.set(result, nextSeen);
  return ProjectionReadModelSchema.parse(result);
}

function mapRow(row: ProjectionRow): ProjectionNode {
  return ProjectionNodeSchema.parse({
    nodeId: row.node_id,
    kind: row.kind,
    projectId: row.project_id,
    goalId: row.goal_id,
    parentNodeId: row.parent_node_id,
    sectorId: row.sector_id,
    state: row.state,
    version: row.version === null ? null : Number(row.version),
    ownerId: row.owner_id,
    crossLinks: row.cross_links ?? [],
    sourceRevision: row.source_revision,
    eventCursor: row.event_cursor,
    removed: row.removed,
    sourceKey: row.source_key,
  });
}

function composeRows(rows: readonly ProjectionRow[], previous: ProjectionReadModel | undefined): ProjectionReadModel {
  const current = rows.map(mapRow);
  const previousById = new Map(previous?.nodes.map((node) => [node.nodeId, node]) ?? []);
  for (const node of current) {
    const prior = previousById.get(node.nodeId);
    if (prior?.version !== null && prior?.version !== undefined && node.version !== null && node.version < prior.version) {
      throw new ProjectionConsistencyError(`Projection version regressed for ${node.kind}:${node.nodeId}`);
    }
  }
  const currentIds = new Set(current.map((node) => node.nodeId));
  const priorRemoved = previous?.nodes.filter((node) => node.removed && !currentIds.has(node.nodeId)) ?? [];
  const removed = previous?.nodes
    .filter((node) => !currentIds.has(node.nodeId) && !node.removed)
    .map((node) => ({ ...node, removed: true })) ?? [];
  const nodes = [...current, ...priorRemoved, ...removed].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const eventCursor = rows.reduce((cursor, row) => compareCursor(cursor, row.event_cursor), previous?.eventCursor ?? "0");
  return ProjectionReadModelSchema.parse({ nodes, edges: edgesFor(nodes), eventCursor });
}

/**
 * Compose the graph from durable read tables in one SQL statement. No projection table or
 * transcript/session state is consulted; source keys and revisions remain visible on every node.
 */
export function createProjectionService(pool: ProjectionQueryable): ProjectionService {
  const read = async (query: ProjectionQuery, previous?: ProjectionReadModel): Promise<ProjectionReadModel> => {
    const scope = ProjectionQuerySchema.parse(query);
    const result = await pool.query<ProjectionRow>(PROJECTION_SQL, [scope.projectId ?? null, scope.goalId ?? null]);
    return composeRows(result.rows, previous);
  };
  return { read, compose: read };
}

export const PROJECTION_SQL = `
WITH source AS (
  SELECT g.goal_id::text AS node_id, 'goal'::text AS kind, g.project_id::text AS project_id, g.goal_id::text AS goal_id,
    NULL::text AS parent_node_id, NULL::text AS sector_id, g.state::text AS state, g.version::text AS version, NULL::text AS owner_id,
    ARRAY[]::text[] AS cross_links, g.version::text AS source_revision,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = g.goal_id), 0)::text AS event_cursor,
    false AS removed, ARRAY[g.goal_id::text]::text[] AS source_key
  FROM goals g

  UNION ALL
  SELECT c.council_id::text, 'council', g.project_id::text, c.goal_id::text, c.goal_id::text, NULL::text, c.state::text, NULL::text,
    NULL::text, ARRAY[c.contract_id::text]::text[], COALESCE((SELECT max(e.event_sequence) FROM council_protocol_events e WHERE e.council_id = c.council_id), 0)::text,
    COALESCE((SELECT max(e.event_sequence) FROM council_protocol_events e WHERE e.council_id = c.council_id), 0)::text, false,
    ARRAY[c.council_id::text]::text[]
  FROM head_councils c JOIN goals g ON g.goal_id = c.goal_id

  UNION ALL
  SELECT 'department-plan:' || p.council_id::text || ':' || p.department_id, 'department_plan', p.project_id::text, p.goal_id::text,
    p.council_id::text, p.department_id, 'active'::text, p.current_version::text, p.head_role_id, ARRAY[p.council_id::text, p.contract_id::text]::text[],
    p.current_version::text, COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = p.goal_id), 0)::text, false,
    ARRAY[p.council_id::text, p.department_id]::text[]
  FROM department_plans p

  UNION ALL
  SELECT b.bundle_id::text, 'mission_bundle', g.project_id::text, g.goal_id::text, 'department-plan:' || b.council_id::text || ':' || b.department_id,
    b.department_id, 'issued'::text, NULL::text, b.department_id, ARRAY[b.council_id::text]::text[], b.content_hash::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = g.goal_id), 0)::text, false, ARRAY[b.bundle_id::text]::text[]
  FROM mission_bundles b JOIN head_councils c ON c.council_id = b.council_id JOIN goals g ON g.goal_id = c.goal_id

  UNION ALL
  SELECT w.worker_id::text, 'worker', g.project_id::text, g.goal_id::text, b.bundle_id::text, w.department_id, w.status::text, NULL::text,
    w.owner_id, ARRAY[w.council_id::text]::text[], w.observed_at::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = g.goal_id), 0)::text, false, ARRAY[w.worker_id::text]::text[]
  FROM workers w JOIN mission_bundles b ON b.council_id = w.council_id AND b.department_id = w.department_id AND b.plan_version = w.plan_version AND b.item_id = w.item_id
    JOIN head_councils c ON c.council_id = w.council_id JOIN goals g ON g.goal_id = c.goal_id

  UNION ALL
  SELECT 'git-goal-branch:' || b.goal_id::text, 'git_goal_branch', g.project_id::text, b.goal_id::text, b.goal_id::text, NULL::text, 'recorded'::text, NULL::text,
    NULL::text, ARRAY[b.branch_name]::text[], b.created_at::text, COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = b.goal_id), 0)::text,
    false, ARRAY[b.goal_id::text]::text[]
  FROM goal_integration_branches b JOIN goals g ON g.goal_id = b.goal_id

  UNION ALL
  SELECT 'git-department-branch:' || b.goal_id::text || ':' || b.department_id, 'git_department_branch', g.project_id::text, b.goal_id::text, b.goal_id::text,
    b.department_id, 'recorded'::text, NULL::text, b.department_id, ARRAY[b.branch_name]::text[], b.created_at::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = b.goal_id), 0)::text, false, ARRAY[b.goal_id::text, b.department_id]::text[]
  FROM department_branches b JOIN goals g ON g.goal_id = b.goal_id

  UNION ALL
  SELECT 'git-worker-worktree:' || w.worker_id::text, 'git_worker_worktree', g.project_id::text, g.goal_id::text, w.worker_id::text, NULL::text,
    'recorded'::text, NULL::text, NULL::text, ARRAY[w.branch_name]::text[], w.created_at::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = g.goal_id), 0)::text, false, ARRAY[w.worker_id::text]::text[]
  FROM worker_worktrees w JOIN workers worker ON worker.worker_id = w.worker_id JOIN head_councils c ON c.council_id = worker.council_id JOIN goals g ON g.goal_id = c.goal_id

  UNION ALL
  SELECT 'git-commit:' || c.commit_id::text, 'git_commit', g.project_id::text, g.goal_id::text, 'git-worker-worktree:' || c.worker_id::text, NULL::text,
    'recorded'::text, NULL::text, NULL::text, ARRAY[c.commit_sha::text]::text[], c.recorded_at::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = g.goal_id), 0)::text, false, ARRAY[c.commit_id::text]::text[]
  FROM integration_commits c JOIN workers worker ON worker.worker_id = c.worker_id JOIN head_councils council ON council.council_id = worker.council_id JOIN goals g ON g.goal_id = council.goal_id

  UNION ALL
  SELECT a.approval_id::text, 'capability_approval', a.project_id::text, a.goal_id::text, a.goal_id::text, a.capability_kind,
    CASE WHEN a.revoked_at IS NULL THEN a.decision::text ELSE 'revoked'::text END, NULL::text, a.approver_id, ARRAY[a.command_id, a.action, a.target]::text[], COALESCE(a.revoked_at, a.created_at)::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = a.goal_id), 0)::text, false, ARRAY[a.approval_id::text]::text[]
  FROM capability_approvals a

  UNION ALL
  SELECT d.digest_id::text, 'improvement_digest', d.project_id::text, d.goal_id::text, d.goal_id::text, NULL::text, d.trigger::text, d.schema_version::text,
    d.author_id, ARRAY[]::text[], d.created_at::text,
    COALESCE((SELECT max(e.global_position) FROM goal_events e WHERE e.goal_id = d.goal_id), 0)::text, false, ARRAY[d.digest_id::text]::text[]
  FROM improvement_digests d
)
SELECT * FROM source
WHERE ($1::uuid IS NULL OR project_id = $1::text)
  AND ($2::uuid IS NULL OR goal_id = $2::text)
ORDER BY kind, node_id
`;
