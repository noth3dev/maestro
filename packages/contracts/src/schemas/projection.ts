import { z } from "zod";
import { CommandVersionSchema, UuidSchema } from "./common.js";
import { EventCursorSchema } from "./events.js";

/** Stable read-side graph contracts. Node identity is the durable source key; sourceKey preserves composite primary keys. */
export const ProjectionNodeKindSchema = z.enum([
  "goal",
  "council",
  "department_plan",
  "mission_bundle",
  "worker",
  "git_goal_branch",
  "git_department_branch",
  "git_worker_worktree",
  "git_commit",
  "capability_approval",
  "improvement_digest",
]);
export type ProjectionNodeKind = z.infer<typeof ProjectionNodeKindSchema>;
const ProjectionNodeIdSchema = z.string().min(1).max(320);
const ProjectionLinkListSchema = z.array(ProjectionNodeIdSchema).max(32).readonly();
export const ProjectionNodeSchema = z
  .object({
    nodeId: ProjectionNodeIdSchema,
    kind: ProjectionNodeKindSchema,
    projectId: UuidSchema,
    goalId: UuidSchema,
    parentNodeId: ProjectionNodeIdSchema.nullable(),
    sectorId: z.string().min(1).nullable(),
    state: z.string().min(1),
    version: CommandVersionSchema.nullable(),
    ownerId: z.string().min(1).nullable(),
    crossLinks: ProjectionLinkListSchema,
    sourceRevision: z.string().min(1),
    eventCursor: EventCursorSchema,
    removed: z.boolean(),
    sourceKey: z.array(z.string().min(1).max(320)).min(1).max(8).readonly(),
  })
  .strict();
export type ProjectionNode = z.infer<typeof ProjectionNodeSchema>;
export const ProjectionEdgeSchema = z
  .object({
    edgeId: ProjectionNodeIdSchema,
    kind: z.enum(["contains", "references", "owns", "tracks"]),
    fromNodeId: ProjectionNodeIdSchema,
    toNodeId: ProjectionNodeIdSchema,
    projectId: UuidSchema,
    goalId: UuidSchema.nullable(),
    sourceRevision: z.string().min(1),
    eventCursor: EventCursorSchema,
    removed: z.boolean(),
  })
  .strict();
export type ProjectionEdge = z.infer<typeof ProjectionEdgeSchema>;
export const ProjectionReadModelSchema = z
  .object({
    nodes: z.array(ProjectionNodeSchema).readonly(),
    edges: z.array(ProjectionEdgeSchema).readonly(),
    eventCursor: EventCursorSchema,
  })
  .strict();
export type ProjectionReadModel = z.infer<typeof ProjectionReadModelSchema>;
export const ProjectionQuerySchema = z
  .object({
    projectId: UuidSchema.optional(),
    goalId: UuidSchema.optional(),
  })
  .strict()
  .refine((value) => value.projectId !== undefined || value.goalId !== undefined, "projection scope requires projectId or goalId");
export type ProjectionQuery = z.infer<typeof ProjectionQuerySchema>;
export const ProjectionEventSchema = z.discriminatedUnion("kind", [
  z.object({ eventId: UuidSchema, cursor: EventCursorSchema, kind: z.literal("upsert"), node: ProjectionNodeSchema }).strict(),
  z.object({ eventId: UuidSchema, cursor: EventCursorSchema, kind: z.literal("remove"), nodeId: ProjectionNodeIdSchema }).strict(),
]);
export type ProjectionEvent = z.infer<typeof ProjectionEventSchema>;
