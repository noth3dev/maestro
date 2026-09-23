import { z } from "zod";
import { isSafeOvertureText, OVERTURE_ROLE_IDS, OVERTURE_ROLE_TAXONOMY_VERSION } from "@maestro/domain";
import { CommandVersionSchema, ModelRefSchema, UuidSchema } from "./common.js";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeContentSchema = z
  .string()
  .min(1)
  .max(60_000)
  .refine((value) => isSafeOvertureText(value), "content contains prohibited sensitive or raw model material");
const SafeMetadataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => isSafeOvertureText(JSON.stringify(value), 65_536), "metadata contains prohibited sensitive or raw model material");
const SafeReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => isSafeOvertureText(value, 512), "reference contains prohibited sensitive material");
const RoleIdSchema = z.enum(OVERTURE_ROLE_IDS);
const ActorSchema = z.union([z.literal("operator"), z.literal("concertmaster"), RoleIdSchema]);

export const OvertureTaskContractRefSchema = z
  .object({ planId: UuidSchema, version: CommandVersionSchema.min(1), manifestHash: HashSchema })
  .strict();
export type OvertureTaskContractRef = z.infer<typeof OvertureTaskContractRefSchema>;
export const OvertureExecutionPhaseSchema = z.literal("overture");

export const OvertureRunStateSchema = z.enum([
  "collecting",
  "waiting_for_operator",
  "synthesizing",
  "review",
  "blocked",
  "launched",
  "cancelled",
]);
export type OvertureRunState = z.infer<typeof OvertureRunStateSchema>;
export const OvertureRoleStatusSchema = z.enum(["queued", "active", "paused", "completed", "failed"]);
export type OvertureRoleStatus = z.infer<typeof OvertureRoleStatusSchema>;

export const OvertureRoleAssignmentSchema = z
  .object({ roleId: RoleIdSchema, status: OvertureRoleStatusSchema, modelRef: ModelRefSchema.nullable() })
  .strict();
export type OvertureRoleAssignment = z.infer<typeof OvertureRoleAssignmentSchema>;

export const OvertureRunSchema = z
  .object({
    runId: UuidSchema,
    conversationId: UuidSchema,
    projectId: UuidSchema,
    goalId: z.null(),
    executionPhase: OvertureExecutionPhaseSchema,
    taskContractRef: OvertureTaskContractRefSchema.nullable(),
    state: OvertureRunStateSchema,
    version: CommandVersionSchema.min(1),
    roleTaxonomyVersion: z.literal(OVERTURE_ROLE_TAXONOMY_VERSION),
    planManifestHash: HashSchema.nullable(),
    taskContractId: z.null(),
    roles: z.array(OvertureRoleAssignmentSchema).min(1).readonly(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.roles.map((role) => role.roleId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", path: ["roles"], message: "roles must not contain duplicates" });
  });
export type OvertureRun = z.infer<typeof OvertureRunSchema>;

export const OvertureEventTypeSchema = z.enum([
  "run_created",
  "role_activated",
  "message_appended",
  "clarification_opened",
  "clarification_answered",
  "artifact_created",
  "artifact_revision_created",
  "plan_revision_created",
  "manifest_revision_created",
  "synthesis_started",
  "review_ready",
  "launch_ready",
  "run_state_changed",
]);
export const OvertureEventSchema = z
  .object({
    eventId: UuidSchema,
    runId: UuidSchema,
    projectId: UuidSchema,
    cursor: z.string().regex(/^(0|[1-9][0-9]*)$/),
    eventType: OvertureEventTypeSchema,
    payload: SafeMetadataSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type OvertureEvent = z.infer<typeof OvertureEventSchema>;

export const OvertureMessageSchema = z
  .object({
    messageId: UuidSchema,
    runId: UuidSchema,
    conversationId: UuidSchema,
    projectId: UuidSchema,
    turnId: UuidSchema,
    cursor: z.string().regex(/^(0|[1-9][0-9]*)$/),
    actor: ActorSchema,
    modelRef: ModelRefSchema.nullable().refine(
      (value) => value === null || isSafeOvertureText(value, 256),
      "model reference contains prohibited sensitive material",
    ),
    content: SafeContentSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type OvertureMessage = z.infer<typeof OvertureMessageSchema>;

export const OvertureClarificationSchema = z
  .object({
    clarificationId: UuidSchema,
    runId: UuidSchema,
    projectId: UuidSchema,
    question: SafeContentSchema,
    answer: SafeContentSchema.nullable(),
    answerCommandId: UuidSchema.nullable(),
    status: z.enum(["open", "answered", "cancelled"]),
    commandId: UuidSchema,
  })
  .strict();
export type OvertureClarification = z.infer<typeof OvertureClarificationSchema>;

export const OvertureArtifactSchema = z
  .object({
    artifactId: UuidSchema,
    runId: UuidSchema,
    projectId: UuidSchema,
    kind: z.enum(["research", "security_finding", "design_mock", "decision"]),
    title: SafeContentSchema.max(256),
    content: SafeContentSchema,
    contentHash: HashSchema,
    sourceRefs: z.array(SafeReferenceSchema).max(128).readonly(),
  })
  .strict();
export type OvertureArtifact = z.infer<typeof OvertureArtifactSchema>;

export const OverturePlanDocumentKindSchema = z.enum(["project", "phase", "slice"]);
export type OverturePlanDocumentKind = z.infer<typeof OverturePlanDocumentKindSchema>;
export const OverturePlanDocumentSchema = z
  .object({
    documentId: UuidSchema,
    projectId: UuidSchema,
    runId: UuidSchema,
    path: z.union([
      z.literal("plan00.md"),
      z.string().regex(/^plan(?:0[1-9]|[1-9][0-9]+)\.md$/),
      z.string().regex(/^plan(?:0[1-9]|[1-9][0-9]+)-slice(?:0[1-9]|[1-9][0-9]+)\.md$/),
    ]),
    kind: OverturePlanDocumentKindSchema,
    version: CommandVersionSchema.min(1),
    content: SafeContentSchema,
    contentHash: HashSchema,
    sourceRefs: z.array(SafeReferenceSchema).max(128).readonly(),
    dependencies: z.array(UuidSchema).max(256).readonly(),
  })
  .strict();
export type OverturePlanDocument = z.infer<typeof OverturePlanDocumentSchema>;

// Runtime grammar validation is supplied by the domain parser; this schema keeps the wire shape strict.
export const OverturePlanReferenceSchema = z
  .object({
    documentId: UuidSchema,
    path: z.union([
      z.literal("plan00.md"),
      z.string().regex(/^plan(?:0[1-9]|[1-9][0-9]+)\.md$/),
      z.string().regex(/^plan(?:0[1-9]|[1-9][0-9]+)-slice(?:0[1-9]|[1-9][0-9]+)\.md$/),
    ]),
    kind: OverturePlanDocumentKindSchema,
    version: CommandVersionSchema.min(1),
    contentHash: HashSchema,
    sourceRefs: z.array(SafeReferenceSchema).max(128).readonly(),
    dependencies: z.array(UuidSchema).max(256).readonly(),
  })
  .strict();
export type OverturePlanReference = z.infer<typeof OverturePlanReferenceSchema>;
export const OverturePlanManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: UuidSchema,
    runId: UuidSchema,
    documents: z.array(OverturePlanReferenceSchema).min(1).readonly(),
    manifestHash: HashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const byPath = new Map(value.documents.map((document) => [document.path, document]));
    const ids = new Set(value.documents.map((document) => document.documentId));
    if (!byPath.has("plan00.md")) context.addIssue({ code: "custom", path: ["documents"], message: "manifest requires plan00.md" });
    for (const document of value.documents) {
      for (const dependency of document.dependencies)
        if (!ids.has(dependency)) context.addIssue({ code: "custom", path: ["documents"], message: `unknown dependency ${dependency}` });
      if (document.kind === "slice") {
        const phasePath = document.path.replace(/-slice(?:0[1-9]|[1-9][0-9]+)\.md$/, ".md");
        const phase = byPath.get(phasePath);
        if (phase === undefined || !document.dependencies.includes(phase.documentId))
          context.addIssue({ code: "custom", path: ["documents"], message: `slice ${document.path} must depend on ${phasePath}` });
      }
    }
  });
export type OverturePlanManifest = z.infer<typeof OverturePlanManifestSchema>;

export const CreateOvertureRunInputSchema = z
  .object({
    runId: UuidSchema,
    projectId: UuidSchema,
    conversationId: UuidSchema,
    roles: z.array(RoleIdSchema).min(1).readonly(),
    commandId: UuidSchema,
  })
  .strict();
export type CreateOvertureRunInput = z.infer<typeof CreateOvertureRunInputSchema>;
export const AppendOvertureMessageInputSchema = z
  .object({
    projectId: UuidSchema,
    runId: UuidSchema,
    conversationId: UuidSchema,
    turnId: UuidSchema,
    actor: ActorSchema,
    modelRef: ModelRefSchema.nullable(),
    content: SafeContentSchema,
    commandId: UuidSchema,
  })
  .strict();
export type AppendOvertureMessageInput = z.infer<typeof AppendOvertureMessageInputSchema>;
export const CreateOvertureArtifactInputSchema = z
  .object({
    projectId: UuidSchema,
    runId: UuidSchema,
    conversationId: UuidSchema,
    kind: OvertureArtifactSchema.shape.kind,
    title: OvertureArtifactSchema.shape.title,
    content: SafeContentSchema,
    contentHash: HashSchema,
    sourceRefs: z.array(SafeReferenceSchema).max(128).readonly(),
    commandId: UuidSchema,
  })
  .strict();
export type CreateOvertureArtifactInput = z.infer<typeof CreateOvertureArtifactInputSchema>;
export const ReviseOverturePlanInputSchema = z
  .object({
    projectId: UuidSchema,
    runId: UuidSchema,
    conversationId: UuidSchema,
    documentId: UuidSchema,
    path: z.string().min(1).max(128),
    kind: OverturePlanDocumentKindSchema,
    content: SafeContentSchema,
    contentHash: HashSchema,
    sourceRefs: z.array(SafeReferenceSchema).max(128).readonly(),
    dependencies: z.array(UuidSchema).max(256).readonly(),
    expectedVersion: CommandVersionSchema.min(0),
    commandId: UuidSchema,
  })
  .strict();
export type ReviseOverturePlanInput = z.infer<typeof ReviseOverturePlanInputSchema>;
export const ReviseOverturePlanBodySchema = ReviseOverturePlanInputSchema.omit({ runId: true, documentId: true, commandId: true });
export type ReviseOverturePlanBody = z.infer<typeof ReviseOverturePlanBodySchema>;
export const OpenOvertureClarificationInputSchema = z
  .object({ projectId: UuidSchema, runId: UuidSchema, conversationId: UuidSchema, question: SafeContentSchema, commandId: UuidSchema })
  .strict();
export type OpenOvertureClarificationInput = z.infer<typeof OpenOvertureClarificationInputSchema>;
export const OpenOvertureClarificationBodySchema = OpenOvertureClarificationInputSchema.omit({ runId: true, commandId: true });
export type OpenOvertureClarificationBody = z.infer<typeof OpenOvertureClarificationBodySchema>;
export const ReadOvertureRunInputSchema = z.object({ projectId: UuidSchema, conversationId: UuidSchema, runId: UuidSchema }).strict();
export const ReadOverturePlanManifestInputSchema = z
  .object({ projectId: UuidSchema, conversationId: UuidSchema, runId: UuidSchema })
  .strict();
export const ReadOvertureEventsInputSchema = z
  .object({
    projectId: UuidSchema,
    conversationId: UuidSchema,
    runId: UuidSchema,
    afterCursor: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .default("0"),
  })
  .strict();

export const AnswerOvertureClarificationInputSchema = z
  .object({
    projectId: UuidSchema,
    runId: UuidSchema,
    conversationId: UuidSchema,
    clarificationId: UuidSchema,
    answer: SafeContentSchema,
    commandId: UuidSchema,
  })
  .strict();
export type AnswerOvertureClarificationInput = z.infer<typeof AnswerOvertureClarificationInputSchema>;

export const CreateOvertureRunBodySchema = z
  .object({ runId: UuidSchema, projectId: UuidSchema, conversationId: UuidSchema, roles: z.array(RoleIdSchema).min(1).readonly() })
  .strict();
export type CreateOvertureRunBody = z.infer<typeof CreateOvertureRunBodySchema>;
export const AppendOvertureOperatorMessageBodySchema = z
  .object({ projectId: UuidSchema, conversationId: UuidSchema, turnId: UuidSchema, content: SafeContentSchema })
  .strict();
export type AppendOvertureOperatorMessageBody = z.infer<typeof AppendOvertureOperatorMessageBodySchema>;
export const OvertureRunQuerySchema = z.object({ projectId: UuidSchema, conversationId: UuidSchema }).strict();
export type OvertureRunQuery = z.infer<typeof OvertureRunQuerySchema>;
export const OvertureEventQuerySchema = z
  .object({
    projectId: UuidSchema,
    conversationId: UuidSchema,
    afterCursor: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .default("0"),
  })
  .strict();

export type OvertureEventQuery = z.infer<typeof OvertureEventQuerySchema>;
